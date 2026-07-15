import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { Colleague, Reply, Turn } from "../colleague/types.js";
import type {
  AgentRuntime,
  RuntimeAccountStatus,
  RuntimeLoginStart,
  RuntimeLoginType,
} from "./agent.js";
import type { MemoryEntry } from "./memory.js";
import {
  buildNativeWorkspaceSnapshot,
  isComputerUseIntent,
  isNativeAppId,
  nativeAppIds,
  nativeConnectorIntentKey,
  nativeUnresolvedAppNames,
  selectNativeConnectors,
  type NativeAppInventory,
  type NativePluginResolution,
  type NativeSkillInput,
  type NativeWorkspaceSnapshot,
} from "./native-workspace.js";
import { buildSystemPrompt, buildTurnPrompt } from "./prompt.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const WORKSPACE_SNAPSHOT_TTL_MS = 5 * 60_000;
const REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

type ErrorCode =
  | "CLOSED"
  | "NO_REPLY"
  | "PROTOCOL_ERROR"
  | "RPC_ERROR"
  | "TIMEOUT"
  | "TURN_FAILED"
  | "TURN_INTERRUPTED"
  | "UNAVAILABLE";

export class CodexAppServerError extends Error {
  readonly name = "CodexAppServerError";

  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** The small process surface used by the stdio transport (also injectable in tests). */
export interface AppServerProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: "error", listener: (error: Error) => void): this;
  on(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
}

export interface CodexAppServerRuntimeOptions {
  bin?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
  startProcess?: () => AppServerProcess;
}

type RpcMessage = Record<string, unknown> & {
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: CodexAppServerError): void;
  timer: NodeJS.Timeout;
}

interface AgentMessage {
  id: string;
  text: string;
  phase: "commentary" | "final_answer" | null;
}

interface TurnCompletion {
  status: string;
}

interface TurnWaiter {
  resolve(text: string): void;
  reject(error: CodexAppServerError): void;
  timer: NodeJS.Timeout;
  onDelta?: (delta: string) => void;
}

interface TurnState {
  messages: Map<string, AgentMessage>;
  deltas: string[];
  deltaListeners: Set<(delta: string) => void>;
  completion?: TurnCompletion;
  waiters: Set<TurnWaiter>;
  cleanupTimer: NodeJS.Timeout;
}

interface ThreadStartResult {
  thread?: { id?: unknown };
}

interface TurnStartResult {
  turn?: { id?: unknown };
}

interface AccountReadResult {
  account?: unknown;
  requiresOpenaiAuth?: unknown;
}

interface SkillsListResult {
  data?: unknown;
}

interface AppsListPage {
  data?: unknown;
  nextCursor?: unknown;
}

interface WorkspaceCacheEntry {
  expiresAt: number;
  value: Promise<NativeWorkspaceSnapshot>;
}

const COMPUTER_USE_SKILL_NAMES = [
  "computer-use:computer-use",
  "computer-use",
] as const;

class CodexAppServerClient {
  private readonly bin: string;
  private readonly timeoutMs: number;
  private readonly startProcess: () => AppServerProcess;
  private process?: AppServerProcess;
  private initializePromise?: Promise<void>;
  private nextRequestId = 1;
  private outputBuffer = "";
  private closed = false;
  private closing = false;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly turns = new Map<string, TurnState>();
  private readonly skillCache = new Map<string, Promise<NativeSkillInput | undefined>>();
  private readonly workspaceCache = new Map<string, WorkspaceCacheEntry>();

  constructor(options: CodexAppServerRuntimeOptions) {
    this.bin = options.bin ?? process.env.CODEX_BIN ?? "codex";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive finite number");
    }
    this.startProcess =
      options.startProcess ??
      (() =>
        spawn(this.bin, ["app-server", "--stdio"], {
          stdio: ["pipe", "pipe", "pipe"],
        }));
  }

  async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    await this.ensureInitialized();
    return (await this.requestRaw(method, params)) as T;
  }

  async waitForTurn(
    turnId: string,
    onDelta?: (delta: string) => void,
  ): Promise<string> {
    const state = this.turnState(turnId);
    if (state.completion) return this.consumeCompletedTurn(turnId, state);

    if (onDelta) {
      for (const delta of state.deltas) onDelta(delta);
      state.deltaListeners.add(onDelta);
    }

    return new Promise<string>((resolve, reject) => {
      const waiter: TurnWaiter = {
        resolve,
        reject,
        onDelta,
        timer: setTimeout(() => {
          state.waiters.delete(waiter);
          if (waiter.onDelta) state.deltaListeners.delete(waiter.onDelta);
          if (state.waiters.size === 0) this.deleteTurn(turnId);
          reject(
            new CodexAppServerError("TIMEOUT", "Codex took too long to reply."),
          );
        }, this.timeoutMs),
      };
      waiter.timer.unref();
      state.waiters.add(waiter);
    });
  }

  async computerUseSkill(cwd: string): Promise<NativeSkillInput | undefined> {
    const cached = this.skillCache.get(cwd);
    if (cached) return cached;
    const pending = this.resolveComputerUseSkill(cwd).catch((error: unknown) => {
      this.skillCache.delete(cwd);
      throw error;
    });
    this.skillCache.set(cwd, pending);
    return pending;
  }

  async nativeWorkspace(
    cwd: string,
    threadId: string,
    text: string,
  ): Promise<NativeWorkspaceSnapshot> {
    const intentKey = nativeConnectorIntentKey(text);
    if (!intentKey) return buildNativeWorkspaceSnapshot([], undefined);

    const now = Date.now();
    const cacheKey = `${cwd}\u0000${threadId}\u0000${intentKey}`;
    const forceRefresh = isConnectorRefreshIntent(text);
    const cached = this.workspaceCache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > now) return cached.value;

    const value = this.resolveNativeWorkspace(
      cwd,
      threadId,
      text,
      forceRefresh,
    ).catch((error: unknown) => {
      this.workspaceCache.delete(cacheKey);
      throw error;
    });
    this.workspaceCache.set(cacheKey, {
      expiresAt: now + WORKSPACE_SNAPSHOT_TTL_MS,
      value,
    });
    return value;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.closing = true;
    this.workspaceCache.clear();
    const closedError = new CodexAppServerError(
      "CLOSED",
      "Codex is not available because the runtime is closed.",
    );
    this.rejectAll(closedError);

    const child = this.process;
    this.process = undefined;
    if (!child) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      let terminateTimer: NodeJS.Timeout | undefined;
      let finishTimer: NodeJS.Timeout | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (terminateTimer) clearTimeout(terminateTimer);
        if (finishTimer) clearTimeout(finishTimer);
        resolve();
      };
      child.once("close", finish);
      child.stdin.end();
      terminateTimer = setTimeout(() => child.kill("SIGTERM"), 500);
      finishTimer = setTimeout(finish, 1_000);
      terminateTimer.unref();
      finishTimer.unref();
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.closed) {
      throw new CodexAppServerError(
        "CLOSED",
        "Codex is not available because the runtime is closed.",
      );
    }
    this.initializePromise ??= this.initialize();
    await this.initializePromise;
  }

  private async initialize(): Promise<void> {
    let child: AppServerProcess;
    try {
      child = this.startProcess();
    } catch {
      throw new CodexAppServerError(
        "UNAVAILABLE",
        "Codex app-server could not be started.",
      );
    }
    this.process = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onOutput(chunk));
    // Always drain stderr so a verbose child cannot block on a full pipe. Raw
    // diagnostics deliberately do not cross this runtime boundary.
    child.stderr.on("data", () => undefined);
    child.on("error", () =>
      this.failTransport(
        new CodexAppServerError(
          "UNAVAILABLE",
          "Codex app-server became unavailable.",
        ),
      ),
    );
    child.on("close", () => {
      this.process = undefined;
      if (!this.closing) {
        this.failTransport(
          new CodexAppServerError(
            "UNAVAILABLE",
            "Codex app-server became unavailable.",
          ),
        );
      }
    });

    await this.requestRaw("initialize", {
      clientInfo: {
        name: "digital-colleague-prototype",
        title: "Digital Colleague",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: [
          "item/reasoning/textDelta",
          "item/reasoning/summaryTextDelta",
          "item/reasoning/summaryPartAdded",
        ],
      },
    });
    this.write({ method: "initialized" });
  }

  private requestRaw(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        new CodexAppServerError(
          "CLOSED",
          "Codex is not available because the runtime is closed.",
        ),
      );
    }
    if (!this.process) {
      return Promise.reject(
        new CodexAppServerError(
          "UNAVAILABLE",
          "Codex app-server is not available.",
        ),
      );
    }

    const id = this.nextRequestId++;
    return new Promise<unknown>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.pending.delete(id);
          reject(
            new CodexAppServerError("TIMEOUT", "Codex took too long to reply."),
          );
        }, this.timeoutMs),
      };
      pending.timer.unref();
      this.pending.set(id, pending);
      try {
        this.write({ id, method, params });
      } catch {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        reject(
          new CodexAppServerError(
            "UNAVAILABLE",
            "Codex app-server is not available.",
          ),
        );
      }
    });
  }

  private async resolveComputerUseSkill(
    cwd: string,
  ): Promise<NativeSkillInput | undefined> {
    const result = await this.request<SkillsListResult>("skills/list", {
      cwds: [cwd],
      forceReload: false,
    });
    if (!Array.isArray(result.data)) return undefined;
    for (const rawEntry of result.data) {
      if (!isRecord(rawEntry) || !Array.isArray(rawEntry.skills)) continue;
      for (const rawSkill of rawEntry.skills) {
        if (
          !isRecord(rawSkill) ||
          rawSkill.enabled !== true ||
          typeof rawSkill.name !== "string" ||
          typeof rawSkill.path !== "string" ||
          !COMPUTER_USE_SKILL_NAMES.includes(
            rawSkill.name as (typeof COMPUTER_USE_SKILL_NAMES)[number],
          )
        ) {
          continue;
        }
        return {
          type: "skill",
          name: rawSkill.name,
          path: rawSkill.path,
        };
      }
    }
    return undefined;
  }

  private async resolveNativeWorkspace(
    cwd: string,
    threadId: string,
    text: string,
    forceRefresh: boolean,
  ): Promise<NativeWorkspaceSnapshot> {
    let pluginInventory: unknown;
    try {
      pluginInventory = await this.request<unknown>("plugin/installed", {
        cwds: [cwd],
      });
    } catch {
      pluginInventory = undefined;
    }

    const selections = selectNativeConnectors(pluginInventory, text);
    const resolutions: NativePluginResolution[] = await Promise.all(
      selections.map(async (selection) => {
        if (
          selection.installed !== true ||
          selection.enabled !== true ||
          (!selection.marketplacePath && !selection.remoteMarketplaceName)
        ) {
          return { selection };
        }
        try {
          const pluginSource = selection.marketplacePath
            ? { marketplacePath: selection.marketplacePath }
            : { remoteMarketplaceName: selection.remoteMarketplaceName };
          const detail = await this.request<unknown>("plugin/read", {
            ...pluginSource,
            pluginName: selection.pluginName,
          });
          return { selection, detail };
        } catch {
          return { selection };
        }
      }),
    );

    const appIds = nativeAppIds(resolutions);
    const appNames = new Set(nativeUnresolvedAppNames(resolutions));
    const appInventory =
      appIds.length > 0 || appNames.size > 0
        ? await this.resolveNativeApps(
            threadId,
            new Set(appIds),
            appNames,
            forceRefresh,
          )
        : undefined;
    return buildNativeWorkspaceSnapshot(resolutions, appInventory);
  }

  private async resolveNativeApps(
    threadId: string,
    targetIds: Set<string>,
    targetNames: Set<string>,
    forceRefetch: boolean,
  ): Promise<NativeAppInventory> {
    const data: unknown[] = [];
    const foundIds = new Set<string>();
    const foundNames = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
      let page: AppsListPage;
      try {
        page = await this.request<AppsListPage>("app/list", {
          cursor,
          limit: 100,
          threadId,
          forceRefetch,
        });
      } catch {
        return { data, complete: false };
      }

      if (Array.isArray(page.data)) {
        data.push(...page.data);
        for (const rawApp of page.data) {
          if (!isRecord(rawApp)) continue;
          if (
            isNativeAppId(rawApp.id) &&
            targetIds.has(rawApp.id)
          ) {
            foundIds.add(rawApp.id);
          }
          if (typeof rawApp.name === "string") {
            const normalizedName = rawApp.name.toLowerCase();
            if (targetNames.has(normalizedName)) {
              foundNames.add(normalizedName);
            }
          }
        }
      }
      if (
        foundIds.size === targetIds.size &&
        foundNames.size === targetNames.size
      ) {
        return { data, complete: page.nextCursor === null };
      }
      if (page.nextCursor === null) return { data, complete: true };
      if (
        typeof page.nextCursor !== "string" ||
        seenCursors.has(page.nextCursor)
      ) {
        return { data, complete: false };
      }
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }

    return { data, complete: false };
  }

  private write(message: RpcMessage): void {
    const child = this.process;
    if (!child || child.stdin.destroyed || !child.stdin.writable) {
      throw new CodexAppServerError(
        "UNAVAILABLE",
        "Codex app-server is not available.",
      );
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onOutput(chunk: string): void {
    this.outputBuffer += chunk;
    let newline = this.outputBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.outputBuffer.slice(0, newline).trim();
      this.outputBuffer = this.outputBuffer.slice(newline + 1);
      if (line) this.onLine(line);
      newline = this.outputBuffer.indexOf("\n");
    }
  }

  private onLine(line: string): void {
    let message: RpcMessage;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) throw new Error("not an object");
      message = parsed;
    } catch {
      this.failTransport(
        new CodexAppServerError(
          "PROTOCOL_ERROR",
          "Codex app-server sent an invalid response.",
        ),
      );
      return;
    }

    if (typeof message.id === "number" && typeof message.method !== "string") {
      this.onResponse(message.id, message);
      return;
    }
    if (typeof message.method === "string" && message.id !== undefined) {
      // This prototype does not implement server-initiated tools or approvals.
      // The thread also uses approvalPolicy=never, but returning a protocol
      // error prevents a surprising request from hanging the app-server.
      this.write({
        id: message.id,
        error: {
          code: -32601,
          message: "Server-initiated requests are not supported by this client.",
        },
      });
      return;
    }
    if (typeof message.method === "string") this.onNotification(message);
  }

  private onResponse(id: number, message: RpcMessage): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (message.error !== undefined) {
      pending.reject(
        new CodexAppServerError(
          "RPC_ERROR",
          "Codex app-server rejected the request.",
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private onNotification(message: RpcMessage): void {
    if (
      message.method === "app/list/updated" ||
      message.method === "mcpServer/startupStatus/updated"
    ) {
      this.workspaceCache.clear();
    }
    if (!isRecord(message.params)) return;
    if (message.method === "item/completed") {
      const turnId = message.params.turnId;
      const item = message.params.item;
      if (typeof turnId === "string" && isRecord(item)) {
        this.captureAgentMessage(turnId, item);
      }
      return;
    }
    if (message.method === "item/agentMessage/delta") {
      const turnId = message.params.turnId;
      const delta = message.params.delta;
      if (typeof turnId === "string" && typeof delta === "string" && delta) {
        const state = this.turnState(turnId);
        state.deltas.push(delta);
        for (const listener of state.deltaListeners) listener(delta);
      }
      return;
    }
    if (message.method === "turn/completed") {
      const turn = message.params.turn;
      if (!isRecord(turn) || typeof turn.id !== "string") return;
      const state = this.turnState(turn.id);
      if (Array.isArray(turn.items)) {
        for (const item of turn.items) {
          if (isRecord(item)) this.captureAgentMessage(turn.id, item);
        }
      }
      state.completion = {
        status: typeof turn.status === "string" ? turn.status : "failed",
      };
      if (state.waiters.size > 0) {
        let result: string | CodexAppServerError;
        try {
          result = this.finalText(state);
        } catch (error) {
          result = asCodexError(error);
        }
        for (const waiter of state.waiters) {
          clearTimeout(waiter.timer);
          if (waiter.onDelta) state.deltaListeners.delete(waiter.onDelta);
          if (typeof result === "string") waiter.resolve(result);
          else waiter.reject(result);
        }
        this.deleteTurn(turn.id);
      }
    }
  }

  private captureAgentMessage(turnId: string, item: Record<string, unknown>): void {
    if (
      item.type !== "agentMessage" ||
      typeof item.id !== "string" ||
      typeof item.text !== "string"
    ) {
      return;
    }
    const phase =
      item.phase === "final_answer" || item.phase === "commentary"
        ? item.phase
        : null;
    this.turnState(turnId).messages.set(item.id, {
      id: item.id,
      text: item.text,
      phase,
    });
  }

  private turnState(turnId: string): TurnState {
    const existing = this.turns.get(turnId);
    if (existing) return existing;
    const state: TurnState = {
      messages: new Map(),
      deltas: [],
      deltaListeners: new Set(),
      waiters: new Set(),
      cleanupTimer: setTimeout(
        () => this.deleteTurn(turnId),
        this.timeoutMs * 2,
      ),
    };
    state.cleanupTimer.unref();
    this.turns.set(turnId, state);
    return state;
  }

  private consumeCompletedTurn(turnId: string, state: TurnState): string {
    try {
      return this.finalText(state);
    } finally {
      this.deleteTurn(turnId);
    }
  }

  private finalText(state: TurnState): string {
    if (state.completion?.status === "failed") {
      throw new CodexAppServerError(
        "TURN_FAILED",
        "Codex could not complete this reply.",
      );
    }
    if (state.completion?.status === "interrupted") {
      throw new CodexAppServerError(
        "TURN_INTERRUPTED",
        "The Codex reply was interrupted.",
      );
    }
    if (state.completion?.status !== "completed") {
      throw new CodexAppServerError(
        "PROTOCOL_ERROR",
        "Codex app-server completed the turn with an unknown status.",
      );
    }

    const messages = [...state.messages.values()];
    const finalMessages = messages.filter(
      (message) => message.phase === "final_answer",
    );
    const phaseUnknown = messages.filter((message) => message.phase === null);
    const selected = finalMessages.length > 0 ? finalMessages : phaseUnknown;
    const text = selected
      .map((message) => message.text.trim())
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (!text) {
      throw new CodexAppServerError(
        "NO_REPLY",
        "Codex completed without a text reply.",
      );
    }
    return text;
  }

  private deleteTurn(turnId: string): void {
    const state = this.turns.get(turnId);
    if (!state) return;
    clearTimeout(state.cleanupTimer);
    this.turns.delete(turnId);
  }

  private failTransport(error: CodexAppServerError): void {
    this.rejectAll(error);
    const child = this.process;
    this.process = undefined;
    if (child && !this.closing) child.kill("SIGTERM");
  }

  private rejectAll(error: CodexAppServerError): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const [turnId, state] of this.turns) {
      for (const waiter of state.waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
      this.deleteTurn(turnId);
    }
  }
}

/**
 * A long-lived Codex-native runtime using the official app-server stdio
 * protocol. One native Codex thread is retained per external colleague thread;
 * turns on that thread are serialized because app-server accepts one active
 * turn at a time.
 */
export class CodexAppServerRuntime implements AgentRuntime {
  readonly name = "codex-app-server";
  private readonly client: CodexAppServerClient;
  private readonly model?: string;
  private readonly reasoningEffort: ReasoningEffort;
  private readonly nativeThreads = new Map<string, string>();
  private readonly queues = new Map<string, Promise<void>>();
  private closed = false;

  constructor(options: CodexAppServerRuntimeOptions = {}) {
    this.client = new CodexAppServerClient(options);
    this.model = options.model ?? (process.env.CODEX_MODEL?.trim() || undefined);
    const configuredEffort =
      options.reasoningEffort ??
      process.env.CODEX_REASONING_EFFORT?.trim().toLowerCase() ??
      "low";
    if (!REASONING_EFFORTS.includes(configuredEffort as ReasoningEffort)) {
      throw new Error(
        `CODEX_REASONING_EFFORT must be one of: ${REASONING_EFFORTS.join(", ")}`,
      );
    }
    this.reasoningEffort = configuredEffort as ReasoningEffort;
  }

  async respond(
    colleague: Colleague,
    history: MemoryEntry[],
    turn: Turn,
    onDelta?: (delta: string) => void,
  ): Promise<Reply> {
    if (this.closed) {
      throw new CodexAppServerError(
        "CLOSED",
        "Codex is not available because the runtime is closed.",
      );
    }
    const key = `${colleague.person.id}:${turn.threadId}`;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(() => this.respondSerially(key, colleague, history, turn, onDelta));
    const settled = queued.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, settled);
    try {
      return await queued;
    } finally {
      if (this.queues.get(key) === settled) this.queues.delete(key);
    }
  }

  async readAccount(): Promise<RuntimeAccountStatus> {
    const result = await this.client.request<AccountReadResult>("account/read", {
      refreshToken: false,
    });
    if (typeof result.requiresOpenaiAuth !== "boolean") {
      throw new CodexAppServerError(
        "PROTOCOL_ERROR",
        "Codex app-server returned an invalid account status.",
      );
    }
    if (result.account === null) {
      return {
        available: true,
        requiresOpenaiAuth: result.requiresOpenaiAuth,
        account: null,
      };
    }
    if (!isRecord(result.account) || typeof result.account.type !== "string") {
      throw new CodexAppServerError(
        "PROTOCOL_ERROR",
        "Codex app-server returned an invalid account.",
      );
    }
    const type = result.account.type;
    if (type !== "apiKey" && type !== "chatgpt" && type !== "amazonBedrock") {
      throw new CodexAppServerError(
        "PROTOCOL_ERROR",
        "Codex app-server returned an unsupported account type.",
      );
    }
    return {
      available: true,
      requiresOpenaiAuth: result.requiresOpenaiAuth,
      account: {
        type,
        ...(type === "chatgpt" && typeof result.account.email === "string"
          ? { email: result.account.email }
          : {}),
      },
    };
  }

  async startLogin(type: RuntimeLoginType): Promise<RuntimeLoginStart> {
    const params =
      type === "chatgpt"
        ? {
            type,
            codexStreamlinedLogin: true,
            useHostedLoginSuccessPage: true,
            appBrand: "codex",
          }
        : { type };
    const result = await this.client.request<unknown>("account/login/start", params);
    if (!isRecord(result) || result.type !== type || typeof result.loginId !== "string") {
      throw new CodexAppServerError(
        "PROTOCOL_ERROR",
        "Codex app-server returned an invalid login response.",
      );
    }
    if (type === "chatgpt" && typeof result.authUrl === "string") {
      return { type, loginId: result.loginId, authUrl: result.authUrl };
    }
    if (
      type === "chatgptDeviceCode" &&
      typeof result.verificationUrl === "string" &&
      typeof result.userCode === "string"
    ) {
      return {
        type,
        loginId: result.loginId,
        verificationUrl: result.verificationUrl,
        userCode: result.userCode,
      };
    }
    throw new CodexAppServerError(
      "PROTOCOL_ERROR",
      "Codex app-server returned an incomplete login response.",
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.nativeThreads.clear();
    await this.client.close();
  }

  private async respondSerially(
    key: string,
    colleague: Colleague,
    history: MemoryEntry[],
    turn: Turn,
    onDelta?: (delta: string) => void,
  ): Promise<Reply> {
    try {
      let nativeThreadId = this.nativeThreads.get(key);
      const firstTurn = nativeThreadId === undefined;
      if (!nativeThreadId) {
        const params: Record<string, unknown> = {
          cwd: colleague.dir,
          approvalPolicy: "never",
          sandbox: "read-only",
          effort: this.reasoningEffort,
          developerInstructions: buildSystemPrompt(colleague),
          ephemeral: true,
          threadSource: "digital-colleague-prototype",
        };
        if (this.model) params.model = this.model;
        const started = await this.client.request<ThreadStartResult>(
          "thread/start",
          params,
        );
        if (typeof started.thread?.id !== "string") {
          throw new CodexAppServerError(
            "PROTOCOL_ERROR",
            "Codex app-server did not return a thread id.",
          );
        }
        nativeThreadId = started.thread.id;
        this.nativeThreads.set(key, nativeThreadId);
      }

      const [computerUseSkill, workspace] = await Promise.all([
        isComputerUseIntent(turn.text)
          ? this.client.computerUseSkill(colleague.dir)
          : Promise.resolve(undefined),
        this.client.nativeWorkspace(colleague.dir, nativeThreadId, turn.text),
      ]);

      if (
        workspace.connectionActions.length > 0 &&
        workspace.accessibleConnectorCount === 0
      ) {
        const links = workspace.connectionActions
          .map(({ label, installUrl }) => `[連接 ${label}](${installUrl})`)
          .join("\n");
        const labels = workspace.connectionActions
          .map(({ label }) => label)
          .join("、");
        const text =
          `${labels} plugin 已安裝，但目前這個 Codex 登入帳號還無法存取 ${labels} connector。\n\n` +
          `${links}\n\n` +
          `請在官方頁面完成 OAuth，並選擇你要連接的 ${labels} 帳號。完成後回來告訴我「重新檢查 ${labels}」。`;
        onDelta?.(text);
        return { text };
      }

      const prompt = buildTurnPrompt(
        colleague,
        firstTurn ? history : [],
        turn,
      ).user;
      const invocationTokens = [...workspace.invocationTokens];
      if (computerUseSkill) {
        const skillName =
          computerUseSkill.name.split(":").at(-1) ?? computerUseSkill.name;
        invocationTokens.push(`$${skillName}`);
      }
      const nativePrompt = invocationTokens.length
        ? `${invocationTokens.join(" ")}\n\n${prompt}`
        : prompt;
      const params: Record<string, unknown> = {
        threadId: nativeThreadId,
        input: [
          {
            type: "text",
            text: workspace.context,
            text_elements: [],
          },
          { type: "text", text: nativePrompt, text_elements: [] },
          ...workspace.inputs,
          ...(computerUseSkill ? [computerUseSkill] : []),
        ],
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        effort: this.reasoningEffort,
      };
      if (this.model) params.model = this.model;
      const startedTurn = await this.client.request<TurnStartResult>(
        "turn/start",
        params,
      );
      if (typeof startedTurn.turn?.id !== "string") {
        throw new CodexAppServerError(
          "PROTOCOL_ERROR",
          "Codex app-server did not return a turn id.",
        );
      }
      const text = await this.client.waitForTurn(startedTurn.turn.id, onDelta);
      return { text };
    } catch (error) {
      this.nativeThreads.delete(key);
      throw asCodexError(error);
    }
  }
}

function asCodexError(error: unknown): CodexAppServerError {
  if (error instanceof CodexAppServerError) return error;
  return new CodexAppServerError(
    "UNAVAILABLE",
    "Codex app-server is not available.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConnectorRefreshIntent(text: string): boolean {
  return /重新檢查|重新連(?:接|線)|recheck|refresh connector/i.test(text);
}
