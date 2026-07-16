import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
const GMAIL_SEND_ROUTING_TEXT = "Gmail 寄信";
const GMAIL_DRAFT_TAG = /<ada-gmail-draft>(\{[^\r\n]*\})<\/ada-gmail-draft>\s*$/;
const UNVERIFIED_GMAIL_SEND_TEXT =
  "尚未確認寄出：Codex app-server 沒有回報符合本回合 Gmail connector 的成功寄信工具結果，因此不能將這封信視為已寄出。";
const NO_PENDING_GMAIL_DRAFT_TEXT =
  "目前沒有一份已顯示且等待核准的 Gmail 草稿。請先交辦回覆內容；Ada 顯示完整收件人、主旨、正文與原信 message ID 後，再回覆「批准寄出」。";
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
  onResult?: (value: unknown) => void;
}

interface AgentMessage {
  id: string;
  text: string;
  phase: "commentary" | "final_answer" | null;
  nativeThreadId?: string;
}

interface TurnCompletion {
  status: string;
  nativeThreadId?: string;
}

interface TurnResult {
  text: string;
  verifiedGmailSend: boolean;
}

interface TurnWaiter {
  resolve(result: TurnResult): void;
  reject(error: CodexAppServerError): void;
  timer: NodeJS.Timeout;
  onDelta?: (delta: string) => void;
}

interface McpToolCallEvidence {
  id: string;
  status: "completed" | "failed";
  hasError: boolean;
  hasResult: boolean;
  nativeThreadId?: string;
  server?: string;
  tool?: string;
  connectorId?: string;
  linkId?: string;
  actionName?: string;
  arguments?: Record<string, unknown>;
  gmailProfileEmail?: string;
  gmailMessages?: GmailMessageEvidence[];
}

interface GmailMessageEvidence {
  id: string;
  threadId: string;
  from: string;
  to: string[];
}

interface ApprovedGmailSend {
  connectorId: string;
  /** The exact OAuth connection verified immediately before execution. */
  linkId?: string;
  to: string;
  subject: string;
  body: string;
  contentType: "text/plain";
  replyMessageId: string;
}

interface EmailAutomationPolicy {
  mailbox: string;
  allowedSenders: Set<string>;
  maxBodyCharacters: number;
}

interface GmailApprovalCandidate {
  nativeThreadId: string;
  connectorId: string;
  policy: EmailAutomationPolicy;
  expectedSend: ApprovedGmailSend;
  turnId?: string;
}

interface TurnState {
  messages: Map<string, AgentMessage>;
  mcpToolCalls: Map<string, McpToolCallEvidence>;
  expectedGmailConnectorIds: Set<string>;
  expectedNativeThreadId?: string;
  gmailVerificationMode:
    | "none"
    | "append_warning"
    | "draft_capture"
    | "require_success";
  approvedGmailSend?: ApprovedGmailSend;
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
  private readonly gmailApprovalCandidates = new Map<
    string,
    GmailApprovalCandidate
  >();

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

  async request<T>(
    method: string,
    params: Record<string, unknown>,
    onResult?: (value: unknown) => void,
  ): Promise<T> {
    await this.ensureInitialized();
    return (await this.requestRaw(method, params, onResult)) as T;
  }

  async startTurn(
    params: Record<string, unknown>,
    approvalCandidate?: GmailApprovalCandidate,
  ): Promise<TurnStartResult> {
    if (approvalCandidate) {
      this.gmailApprovalCandidates.set(
        approvalCandidate.nativeThreadId,
        approvalCandidate,
      );
    }
    try {
      return await this.request<TurnStartResult>(
        "turn/start",
        params,
        approvalCandidate
          ? (value) => {
              if (
                !isRecord(value) ||
                !isRecord(value.turn) ||
                typeof value.turn.id !== "string"
              ) {
                throw new Error("missing turn id");
              }
              const active = this.gmailApprovalCandidates.get(
                approvalCandidate.nativeThreadId,
              );
              if (active === approvalCandidate) active.turnId = value.turn.id;
            }
          : undefined,
      );
    } catch (error) {
      if (
        approvalCandidate &&
        this.gmailApprovalCandidates.get(approvalCandidate.nativeThreadId) ===
          approvalCandidate
      ) {
        this.gmailApprovalCandidates.delete(approvalCandidate.nativeThreadId);
      }
      throw error;
    }
  }

  clearGmailApprovalCandidate(nativeThreadId: string, turnId: string): void {
    const candidate = this.gmailApprovalCandidates.get(nativeThreadId);
    if (candidate?.turnId === turnId) {
      this.gmailApprovalCandidates.delete(nativeThreadId);
    }
  }

  async waitForTurn(
    turnId: string,
    nativeThreadId: string,
    onDelta?: (delta: string) => void,
    expectedGmailConnectorIds: readonly string[] = [],
    gmailVerificationMode: TurnState["gmailVerificationMode"] = "none",
  ): Promise<TurnResult> {
    const state = this.turnState(turnId);
    state.expectedNativeThreadId = nativeThreadId;
    state.gmailVerificationMode = gmailVerificationMode;
    for (const connectorId of expectedGmailConnectorIds) {
      state.expectedGmailConnectorIds.add(connectorId);
    }
    if (state.completion) return this.consumeCompletedTurn(turnId, state);

    if (onDelta) {
      for (const delta of state.deltas) onDelta(delta);
      state.deltaListeners.add(onDelta);
    }

    return new Promise<TurnResult>((resolve, reject) => {
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
    forceRefreshOverride = false,
  ): Promise<NativeWorkspaceSnapshot> {
    const intentKey = nativeConnectorIntentKey(text);
    if (!intentKey) return buildNativeWorkspaceSnapshot([], undefined);

    const now = Date.now();
    const cacheKey = `${cwd}\u0000${threadId}\u0000${intentKey}`;
    const forceRefresh =
      forceRefreshOverride || isConnectorRefreshIntent(text);
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
    this.gmailApprovalCandidates.clear();
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
    onResult?: (value: unknown) => void,
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
        onResult,
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

    const declaredWorkspace = buildNativeWorkspaceSnapshot(
      resolutions,
      undefined,
    );
    if (
      isConnectorSetupIntent(text) &&
      declaredWorkspace.officialConnectionLinks.length > 0
    ) {
      return declaredWorkspace;
    }

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
      if (message.method === "mcpServer/elicitation/request") {
        this.write({
          id: message.id,
          result: this.resolveGmailElicitation(message.params),
        });
        return;
      }
      // Other server-initiated methods remain unsupported. Returning a
      // protocol error prevents a surprising request from hanging app-server.
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

  private resolveGmailElicitation(params: unknown): Record<string, unknown> {
    if (!isRecord(params) || typeof params.threadId !== "string") {
      return declineElicitation();
    }
    const candidate = this.gmailApprovalCandidates.get(params.threadId);
    if (!candidate) return declineElicitation();

    // The first elicitation for an armed turn consumes its one-shot capability,
    // whether it is valid or malformed.
    this.gmailApprovalCandidates.delete(params.threadId);
    if (
      typeof params.turnId !== "string" ||
      candidate.turnId !== params.turnId ||
      candidate.nativeThreadId !== params.threadId
    ) {
      return declineElicitation();
    }
    const approved = parseApprovedGmailSend(params, candidate);
    const state = this.turnState(params.turnId);
    const verifiedLinkId = approved
      ? verifiedGmailLinkId(state, candidate, approved)
      : undefined;
    if (
      !approved ||
      !gmailSendEnvelopeMatches(approved, candidate.expectedSend) ||
      !verifiedLinkId
    ) {
      return declineElicitation();
    }
    state.approvedGmailSend = { ...approved, linkId: verifiedLinkId };
    return { action: "accept", content: null, _meta: null };
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
    try {
      pending.onResult?.(message.result);
    } catch {
      pending.reject(
        new CodexAppServerError(
          "PROTOCOL_ERROR",
          "Codex app-server returned an invalid response.",
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
      const nativeThreadId = message.params.threadId;
      const turnId = message.params.turnId;
      const item = message.params.item;
      if (
        typeof nativeThreadId === "string" &&
        typeof turnId === "string" &&
        isRecord(item)
      ) {
        this.captureTurnItem(nativeThreadId, turnId, item);
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
      const nativeThreadId = message.params.threadId;
      const turn = message.params.turn;
      if (
        typeof nativeThreadId !== "string" ||
        !isRecord(turn) ||
        typeof turn.id !== "string"
      ) {
        return;
      }
      const state = this.turnState(turn.id);
      if (Array.isArray(turn.items)) {
        for (const item of turn.items) {
          if (isRecord(item)) {
            this.captureTurnItem(nativeThreadId, turn.id, item);
          }
        }
      }
      state.completion = {
        status: typeof turn.status === "string" ? turn.status : "failed",
        nativeThreadId,
      };
      this.clearGmailApprovalCandidate(nativeThreadId, turn.id);
      if (state.waiters.size > 0) {
        let result: TurnResult | CodexAppServerError;
        try {
          result = this.finalResult(state);
        } catch (error) {
          result = asCodexError(error);
        }
        for (const waiter of state.waiters) {
          clearTimeout(waiter.timer);
          if (waiter.onDelta) state.deltaListeners.delete(waiter.onDelta);
          if (result instanceof CodexAppServerError) waiter.reject(result);
          else waiter.resolve(result);
        }
        this.deleteTurn(turn.id);
      }
    }
  }

  private captureTurnItem(
    nativeThreadId: string,
    turnId: string,
    item: Record<string, unknown>,
  ): void {
    this.captureAgentMessage(nativeThreadId, turnId, item);
    this.captureMcpToolCall(nativeThreadId, turnId, item);
  }

  private captureAgentMessage(
    nativeThreadId: string,
    turnId: string,
    item: Record<string, unknown>,
  ): void {
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
      nativeThreadId,
    });
  }

  private captureMcpToolCall(
    nativeThreadId: string,
    turnId: string,
    item: Record<string, unknown>,
  ): void {
    if (
      item.type !== "mcpToolCall" ||
      typeof item.id !== "string" ||
      (item.status !== "completed" && item.status !== "failed")
    ) {
      return;
    }
    const appContext = isRecord(item.appContext) ? item.appContext : undefined;
    const gmailProfileEmail = gmailProfileEmailFromToolItem(item, appContext);
    const gmailMessages = gmailMessagesFromToolItem(item, appContext);
    this.turnState(turnId).mcpToolCalls.set(item.id, {
      id: item.id,
      status: item.status,
      hasError: item.error !== null && item.error !== undefined,
      hasResult: isRecord(item.result),
      nativeThreadId,
      ...(typeof item.server === "string" ? { server: item.server } : {}),
      ...(typeof item.tool === "string" ? { tool: item.tool } : {}),
      ...(typeof appContext?.connectorId === "string"
        ? { connectorId: appContext.connectorId }
        : {}),
      ...(typeof appContext?.linkId === "string" && appContext.linkId
        ? { linkId: appContext.linkId }
        : {}),
      ...(typeof appContext?.actionName === "string"
        ? { actionName: appContext.actionName }
        : {}),
      ...(isRecord(item.arguments) ? { arguments: item.arguments } : {}),
      ...(gmailProfileEmail ? { gmailProfileEmail } : {}),
      ...(gmailMessages.length > 0 ? { gmailMessages } : {}),
    });
  }

  private turnState(turnId: string): TurnState {
    const existing = this.turns.get(turnId);
    if (existing) return existing;
    const state: TurnState = {
      messages: new Map(),
      mcpToolCalls: new Map(),
      expectedGmailConnectorIds: new Set(),
      gmailVerificationMode: "none",
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

  private consumeCompletedTurn(turnId: string, state: TurnState): TurnResult {
    try {
      return this.finalResult(state);
    } finally {
      this.deleteTurn(turnId);
    }
  }

  private finalResult(state: TurnState): TurnResult {
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
    if (
      !state.expectedNativeThreadId ||
      state.completion.nativeThreadId !== state.expectedNativeThreadId
    ) {
      throw new CodexAppServerError(
        "PROTOCOL_ERROR",
        "Codex app-server completed a turn for an unexpected thread.",
      );
    }

    const messages = [...state.messages.values()].filter(
      (message) => message.nativeThreadId === state.expectedNativeThreadId,
    );
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
    const verifiedGmailSend = hasSuccessfulGmailSendEvidence(state);
    if (!verifiedGmailSend && state.gmailVerificationMode === "require_success") {
      return { text: UNVERIFIED_GMAIL_SEND_TEXT, verifiedGmailSend };
    }
    if (
      !verifiedGmailSend &&
      state.gmailVerificationMode === "append_warning" &&
      !text.includes(UNVERIFIED_GMAIL_SEND_TEXT)
    ) {
      return {
        text: `${text}\n\n${UNVERIFIED_GMAIL_SEND_TEXT}`,
        verifiedGmailSend,
      };
    }
    return { text, verifiedGmailSend };
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
  private readonly gmailApprovalContinuations = new Map<
    string,
    ApprovedGmailSend
  >();
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
    this.gmailApprovalContinuations.clear();
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
      const approvedGmailDraft = this.takeGmailApprovalContinuation(
        key,
        turn.text,
      );
      if (isExactGmailSendApproval(turn.text) && !approvedGmailDraft) {
        onDelta?.(NO_PENDING_GMAIL_DRAFT_TEXT);
        return { text: NO_PENDING_GMAIL_DRAFT_TEXT };
      }
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
        this.client.nativeWorkspace(
          colleague.dir,
          nativeThreadId,
          approvedGmailDraft ? GMAIL_SEND_ROUTING_TEXT : turn.text,
          approvedGmailDraft !== undefined,
        ),
      ]);

      if (
        isConnectorSetupIntent(turn.text) &&
        workspace.officialConnectionLinks.length > 0
      ) {
        const labels = workspace.officialConnectionLinks
          .map(({ label }) => label)
          .join("、");
        const links = workspace.officialConnectionLinks
          .map(({ label, installUrl }) => `[連接 ${label}](${installUrl})`)
          .join("\n");
        const text =
          `請使用 ${labels} 的官方連接頁完成 OAuth，並在官方頁面選擇你要連接的 ${labels} 帳號。\n\n` +
          `${links}\n\n` +
          `完成後回來告訴我「重新檢查 ${labels}」。`;
        onDelta?.(text);
        return { text };
      }

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
      const selectedGmailConnectorIds = gmailConnectorIds(workspace);
      const capturesGmailDraft =
        !approvedGmailDraft && isGmailSendIntent(turn.text);
      const emailPolicy =
        approvedGmailDraft || capturesGmailDraft
          ? await readEmailAutomationPolicy(
              colleague.dir,
              colleague.info.accounts.gmail?.address,
            )
          : undefined;
      const canUseOneGmailConnector =
        selectedGmailConnectorIds.length === 1 &&
        Boolean(selectedGmailConnectorIds[0]);
      const gmailVerificationMode: TurnState["gmailVerificationMode"] =
        approvedGmailDraft
          ? "require_success"
          : capturesGmailDraft && emailPolicy && canUseOneGmailConnector
            ? "draft_capture"
            : capturesGmailDraft
              ? "append_warning"
            : "none";
      const approvalCandidate =
        approvedGmailDraft &&
        emailPolicy &&
        canUseOneGmailConnector &&
        selectedGmailConnectorIds[0]
          ? {
              nativeThreadId,
              connectorId: selectedGmailConnectorIds[0],
              policy: emailPolicy,
              expectedSend: approvedGmailDraft,
            }
          : undefined;
      const gmailControlContext = approvalCandidate
        ? buildGmailApprovalInstruction(
            approvalCandidate.policy,
            approvalCandidate.expectedSend,
          )
        : gmailVerificationMode === "draft_capture" && emailPolicy
          ? buildGmailDraftInstruction(emailPolicy)
          : undefined;
      const params: Record<string, unknown> = {
        threadId: nativeThreadId,
        input: [
          {
            type: "text",
            text: workspace.context,
            text_elements: [],
          },
          ...(gmailControlContext
            ? [
                {
                  type: "text",
                  text: gmailControlContext,
                  text_elements: [],
                },
              ]
            : []),
          { type: "text", text: nativePrompt, text_elements: [] },
          ...workspace.inputs,
          ...(computerUseSkill ? [computerUseSkill] : []),
        ],
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        effort: this.reasoningEffort,
      };
      if (this.model) params.model = this.model;
      const startedTurn = await this.client.startTurn(
        params,
        approvalCandidate,
      );
      if (typeof startedTurn.turn?.id !== "string") {
        throw new CodexAppServerError(
          "PROTOCOL_ERROR",
          "Codex app-server did not return a turn id.",
        );
      }
      let result: TurnResult;
      try {
        result = await this.client.waitForTurn(
          startedTurn.turn.id,
          nativeThreadId,
          gmailVerificationMode === "none" ? onDelta : undefined,
          selectedGmailConnectorIds,
          gmailVerificationMode,
        );
      } finally {
        this.client.clearGmailApprovalCandidate(
          nativeThreadId,
          startedTurn.turn.id,
        );
      }
      let responseText = result.text;
      if (
        gmailVerificationMode === "draft_capture" &&
        emailPolicy &&
        selectedGmailConnectorIds[0]
      ) {
        const draft = parseGmailDraftContract(
          result.text,
          selectedGmailConnectorIds[0],
          emailPolicy,
        );
        if (draft) {
          this.gmailApprovalContinuations.set(key, draft);
          responseText = formatGmailDraftForApproval(emailPolicy.mailbox, draft);
        } else {
          responseText =
            "未建立可核准的 Gmail 草稿：Ada 沒有回傳完整且安全的收件人、主旨、正文與原信 message ID。沒有寄出任何郵件。";
        }
      }
      if (gmailVerificationMode !== "none") onDelta?.(responseText);
      return { text: responseText };
    } catch (error) {
      this.nativeThreads.delete(key);
      throw asCodexError(error);
    }
  }

  private takeGmailApprovalContinuation(
    key: string,
    text: string,
  ): ApprovedGmailSend | undefined {
    const pending = this.gmailApprovalContinuations.get(key);
    this.gmailApprovalContinuations.delete(key);
    return pending && isExactGmailSendApproval(text) ? pending : undefined;
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

function isConnectorSetupIntent(text: string): boolean {
  return /登入|連接|連線|\bconnect\b|\bsign\s*in\b|切換.{0,8}帳號|(?:我要|請|幫我|開始|進行|完成|開啟).{0,8}(?:授權|\boauth\b)/i.test(
    text,
  );
}

function isExactGmailSendApproval(text: string): boolean {
  const normalized = text.trim();
  return normalized === "批准寄出" || normalized === "確認寄出";
}

function buildGmailDraftInstruction(policy: EmailAutomationPolicy): string {
  return [
    "# TRUSTED GMAIL DRAFT CAPTURE",
    "This turn may inspect Gmail but must not send, draft, label, archive, or mutate mail.",
    `The connected mailbox must be ${policy.mailbox}.`,
    `The only allowed reply recipients are: ${[...policy.allowedSenders].join(", ")}.`,
    "After grounding the exact original Gmail message, end the final answer with one single-line contract and nothing after it:",
    '<ada-gmail-draft>{"to":"...","subject":"...","body":"...","content_type":"text/plain","reply_message_id":"..."}</ada-gmail-draft>',
    "Use JSON escaping for line breaks. The runtime, not your prose, will render the approval preview. Do not call gmail.send_email in this turn.",
  ].join("\n");
}

function buildGmailApprovalInstruction(
  policy: EmailAutomationPolicy,
  approved: ApprovedGmailSend,
): string {
  return [
    "# TRUSTED GMAIL APPROVAL EXECUTION",
    `First call gmail.get_profile with no arguments and verify the email is exactly ${policy.mailbox}.`,
    `Then call gmail.read_email_thread for message ${approved.replyMessageId} and verify that exact inbound message belongs to the same mailbox and came from ${approved.to}.`,
    "Only after both read-only checks succeed, call gmail.send_email with exactly this immutable envelope:",
    canonicalGmailEnvelopeJson(approved),
    "Do not alter any field and do not perform any other write.",
  ].join("\n");
}

function parseGmailDraftContract(
  text: string,
  connectorId: string,
  policy: EmailAutomationPolicy,
): ApprovedGmailSend | undefined {
  const match = text.match(GMAIL_DRAFT_TAG);
  if (!match?.[1]) return undefined;
  let fields: unknown;
  try {
    fields = JSON.parse(match[1]) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(fields) || !hasExactGmailEnvelopeKeys(fields)) return undefined;
  return approvedGmailSendFromFields(fields, connectorId, policy);
}

function formatGmailDraftForApproval(
  mailbox: string,
  draft: ApprovedGmailSend,
): string {
  const display = JSON.stringify(
    {
      mailbox,
      to: draft.to,
      subject: draft.subject,
      body: draft.body,
      content_type: draft.contentType,
      reply_message_id: draft.replyMessageId,
    },
    null,
    2,
  )
    .replaceAll("`", "\\u0060")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
  return (
    "Gmail 回覆草稿（核准後只會照這份內容寄出）：\n\n" +
    `\`\`\`json\n${display}\n\`\`\`\n\n` +
    "若以上內容正確，請回覆「批准寄出」。任何其他訊息都會使這份核准失效。"
  );
}

function canonicalGmailEnvelopeJson(draft: ApprovedGmailSend): string {
  return JSON.stringify({
    to: draft.to,
    subject: draft.subject,
    body: draft.body,
    content_type: draft.contentType,
    reply_message_id: draft.replyMessageId,
  });
}

function isGmailSendIntent(text: string): boolean {
  const selectsGmail = nativeConnectorIntentKey(text)
    .split(",")
    .some((intent) => intent === "gmail" || intent.startsWith("gmail:"));
  if (!selectsGmail) return false;
  return (
    /寄信|寄出|寄送|發送|送出|回信|轉寄|\b(?:send|reply|forward)(?:ing)?\b/i.test(
      text,
    ) ||
    /(?:回覆|回應|答覆).{0,32}(?:信|郵件)/i.test(text) ||
    /(?:請|幫我|替我|麻煩).{0,24}(?:信|郵件).{0,24}(?:回覆|回應|答覆)/i.test(
      text,
    )
  );
}

function gmailConnectorIds(workspace: NativeWorkspaceSnapshot): string[] {
  return workspace.inputs
    .filter(
      (input) =>
        input.type === "mention" &&
        input.name.toLowerCase() === "gmail" &&
        input.path.startsWith("app://"),
    )
    .map((input) => input.path.slice("app://".length))
    .filter(Boolean);
}

function gmailSendEnvelopeMatches(
  actual: ApprovedGmailSend,
  expected: ApprovedGmailSend,
): boolean {
  return (
    actual.connectorId === expected.connectorId &&
    actual.to === expected.to &&
    actual.subject === expected.subject &&
    actual.body === expected.body &&
    actual.contentType === expected.contentType &&
    actual.replyMessageId === expected.replyMessageId
  );
}

function verifiedGmailLinkId(
  state: TurnState,
  candidate: GmailApprovalCandidate,
  approved: ApprovedGmailSend,
): string | undefined {
  const evidence = [...state.mcpToolCalls.values()].filter(
    (item) =>
      item.status === "completed" &&
      !item.hasError &&
      item.hasResult &&
      item.nativeThreadId === candidate.nativeThreadId &&
      item.server === "codex_apps" &&
      item.connectorId === candidate.connectorId &&
      typeof item.linkId === "string",
  );
  const profiles = evidence.filter(
    (item) =>
      item.tool === "gmail.get_profile" &&
      item.actionName === "get_profile" &&
      item.gmailProfileEmail === candidate.policy.mailbox &&
      item.arguments !== undefined &&
      Object.keys(item.arguments).length === 0,
  );
  const reads = evidence.filter((item) => {
    if (
      item.tool !== "gmail.read_email_thread" ||
      item.actionName !== "read_email_thread" ||
      !item.arguments ||
      item.arguments.id !== approved.replyMessageId ||
      item.arguments.id_type !== "message" ||
      (item.arguments.max_messages !== undefined &&
        (!Number.isSafeInteger(item.arguments.max_messages) ||
          (item.arguments.max_messages as number) < 1 ||
          (item.arguments.max_messages as number) > 10)) ||
      Object.keys(item.arguments).some(
        (key) => !["id", "id_type", "max_messages"].includes(key),
      )
    ) {
      return false;
    }
    return (item.gmailMessages ?? []).some(
      (message) =>
        message.id === approved.replyMessageId &&
        message.threadId.length > 0 &&
        message.from === approved.to &&
        message.to.includes(candidate.policy.mailbox),
    );
  });
  return profiles.find((profile) =>
    reads.some((read) => read.linkId === profile.linkId),
  )?.linkId;
}

function gmailProfileEmailFromToolItem(
  item: Record<string, unknown>,
  appContext: Record<string, unknown> | undefined,
): string | undefined {
  if (
    item.status !== "completed" ||
    item.error !== null ||
    item.server !== "codex_apps" ||
    item.tool !== "gmail.get_profile" ||
    appContext?.actionName !== "get_profile" ||
    !isRecord(item.result) ||
    !isRecord(item.result.structuredContent)
  ) {
    return undefined;
  }
  return normalizeEmailAddress(item.result.structuredContent.email);
}

function gmailMessagesFromToolItem(
  item: Record<string, unknown>,
  appContext: Record<string, unknown> | undefined,
): GmailMessageEvidence[] {
  if (
    item.status !== "completed" ||
    item.error !== null ||
    item.server !== "codex_apps" ||
    item.tool !== "gmail.read_email_thread" ||
    appContext?.actionName !== "read_email_thread" ||
    !isRecord(item.result) ||
    !isRecord(item.result.structuredContent) ||
    !Array.isArray(item.result.structuredContent.messages)
  ) {
    return [];
  }
  return item.result.structuredContent.messages.flatMap((value) => {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      !isValidReplyMessageId(value.id) ||
      typeof value.thread_id !== "string" ||
      !isValidReplyMessageId(value.thread_id)
    ) {
      return [];
    }
    const from = extractHeaderEmailAddress(value.from_);
    const to = Array.isArray(value.to)
      ? value.to
          .map(extractHeaderEmailAddress)
          .filter((email): email is string => email !== undefined)
      : [];
    if (!from || to.length === 0) return [];
    return [{ id: value.id, threadId: value.thread_id, from, to }];
  });
}

function extractHeaderEmailAddress(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? normalizeEmailAddress(match[0].toLowerCase()) : undefined;
}

function hasSuccessfulGmailSendEvidence(state: TurnState): boolean {
  const approved = state.approvedGmailSend;
  if (
    !approved ||
    !approved.linkId ||
    !state.expectedNativeThreadId ||
    !state.expectedGmailConnectorIds.has(approved.connectorId)
  ) {
    return false;
  }
  return [...state.mcpToolCalls.values()].some((evidence) => {
    if (
      evidence.status !== "completed" ||
      evidence.hasError ||
      !evidence.hasResult ||
      evidence.nativeThreadId !== state.expectedNativeThreadId ||
      evidence.server !== "codex_apps" ||
      evidence.tool !== "gmail.send_email" ||
      evidence.actionName !== "send_email" ||
      evidence.connectorId !== approved.connectorId ||
      evidence.linkId !== approved.linkId ||
      !evidence.arguments
    ) {
      return false;
    }
    return gmailSendArgumentsMatch(evidence.arguments, approved);
  });
}

function gmailSendArgumentsMatch(
  args: Record<string, unknown>,
  approved: ApprovedGmailSend,
): boolean {
  const expectedKeys = [
    "body",
    "content_type",
    "reply_message_id",
    "subject",
    "to",
  ];
  if (Object.keys(args).sort().join("\u0000") !== expectedKeys.join("\u0000")) {
    return false;
  }
  return (
    normalizeEmailAddress(args.to) === approved.to &&
    args.subject === approved.subject &&
    args.body === approved.body &&
    args.content_type === approved.contentType &&
    args.reply_message_id === approved.replyMessageId
  );
}

async function readEmailAutomationPolicy(
  colleagueDir: string,
  configuredMailbox: unknown,
): Promise<EmailAutomationPolicy | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await readFile(
        join(colleagueDir, "policies", "email-automation.json"),
        "utf8",
      ),
    ) as unknown;
  } catch {
    return undefined;
  }
  const mailbox = normalizeEmailAddress(
    isRecord(parsed) ? parsed.mailbox : undefined,
  );
  const expectedMailbox = normalizeEmailAddress(configuredMailbox);
  const supportedKinds = new Set([
    "acknowledgement",
    "clarifying_question",
    "status_update",
  ]);
  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    parsed.enabled !== true ||
    parsed.mode !== "owner_only" ||
    parsed.interruptible !== true ||
    !mailbox ||
    !expectedMailbox ||
    mailbox !== expectedMailbox ||
    parsed.requireSameThread !== true ||
    parsed.allowNewRecipients !== false ||
    parsed.allowCc !== false ||
    parsed.allowBcc !== false ||
    parsed.allowAttachments !== false ||
    parsed.maxRepliesPerMessage !== 1 ||
    !Number.isSafeInteger(parsed.maxBodyCharacters) ||
    (parsed.maxBodyCharacters as number) <= 0 ||
    (parsed.maxBodyCharacters as number) > 2_000 ||
    !Array.isArray(parsed.allowedSenders) ||
    !Array.isArray(parsed.allowedReplyKinds) ||
    parsed.allowedReplyKinds.length === 0 ||
    parsed.allowedReplyKinds.some(
      (kind) => typeof kind !== "string" || !supportedKinds.has(kind),
    )
  ) {
    return undefined;
  }
  const allowedSenders = new Set<string>();
  for (const value of parsed.allowedSenders) {
    const normalized = normalizeEmailAddress(value);
    if (!normalized) return undefined;
    allowedSenders.add(normalized);
  }
  if (allowedSenders.size === 0) return undefined;
  return {
    mailbox,
    allowedSenders,
    maxBodyCharacters: parsed.maxBodyCharacters as number,
  };
}

function parseApprovedGmailSend(
  params: Record<string, unknown>,
  candidate: GmailApprovalCandidate,
): ApprovedGmailSend | undefined {
  if (params.serverName !== "codex_apps" || params.mode !== "form") {
    return undefined;
  }
  const schema = isRecord(params.requestedSchema)
    ? params.requestedSchema
    : undefined;
  if (
    !schema ||
    schema.type !== "object" ||
    !isRecord(schema.properties) ||
    Object.keys(schema.properties).length !== 0
  ) {
    return undefined;
  }
  const meta = isRecord(params._meta) ? params._meta : undefined;
  if (
    !meta ||
    meta.codex_approval_kind !== "mcp_tool_call" ||
    meta.source !== "connector" ||
    meta.connector_id !== candidate.connectorId ||
    meta.connector_name !== "Gmail" ||
    meta.tool_title !== "send_email"
  ) {
    return undefined;
  }
  const fields = parseToolDisplayFields(meta.tool_params_display);
  if (!fields) return undefined;

  return approvedGmailSendFromFields(
    fields,
    candidate.connectorId,
    candidate.policy,
  );
}

function approvedGmailSendFromFields(
  fields: Record<string, unknown>,
  connectorId: string,
  policy: EmailAutomationPolicy,
): ApprovedGmailSend | undefined {
  const to = normalizeEmailAddress(fields.to);
  const subject = fields.subject;
  const body = fields.body;
  const contentType = fields.content_type;
  const replyMessageId = fields.reply_message_id;
  if (
    !to ||
    !policy.allowedSenders.has(to) ||
    typeof subject !== "string" ||
    subject.trim().length === 0 ||
    subject.length > 998 ||
    typeof body !== "string" ||
    body.trim().length === 0 ||
    contentType !== "text/plain" ||
    typeof replyMessageId !== "string" ||
    !isValidReplyMessageId(replyMessageId) ||
    hasUnsafeEmailSubject(subject) ||
    hasUnsafeEmailBody(body) ||
    [...body].length > policy.maxBodyCharacters
  ) {
    return undefined;
  }
  return {
    connectorId,
    to,
    subject,
    body,
    contentType,
    replyMessageId,
  };
}

function hasExactGmailEnvelopeKeys(value: Record<string, unknown>): boolean {
  const expected = [
    "body",
    "content_type",
    "reply_message_id",
    "subject",
    "to",
  ];
  return Object.keys(value).sort().join("\u0000") === expected.join("\u0000");
}

function parseToolDisplayFields(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!Array.isArray(value) || value.length !== 5) return undefined;
  const expectedNames = new Set([
    "to",
    "subject",
    "body",
    "content_type",
    "reply_message_id",
  ]);
  const fields: Record<string, unknown> = {};
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.name !== "string" ||
      !expectedNames.has(entry.name) ||
      Object.hasOwn(fields, entry.name)
    ) {
      return undefined;
    }
    fields[entry.name] = entry.value;
  }
  return Object.keys(fields).length === expectedNames.size ? fields : undefined;
}

function normalizeEmailAddress(value: unknown): string | undefined {
  if (typeof value !== "string" || value !== value.trim()) return undefined;
  if (
    value.length > 254 ||
    /[\s<>,;\u0000-\u001f\u007f-\u009f]/u.test(value) ||
    !/^[^@]+@[^@]+\.[^@]+$/.test(value)
  ) {
    return undefined;
  }
  return value.toLowerCase();
}

function isValidReplyMessageId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,256}$/.test(value);
}

function hasUnsafeEmailSubject(value: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value);
}

function hasUnsafeEmailBody(value: string): boolean {
  // Plain-text email bodies may contain horizontal tabs and LF line breaks.
  // Reject CR and all other control/line-separator characters so the value
  // cannot be reinterpreted as an RFC 5322 header block.
  return /[\u0000-\u0008\u000b\u000c\u000d\u000e-\u001f\u007f-\u009f\u2028\u2029]/u.test(
    value,
  );
}

function declineElicitation(): Record<string, unknown> {
  return { action: "decline", content: null, _meta: null };
}
