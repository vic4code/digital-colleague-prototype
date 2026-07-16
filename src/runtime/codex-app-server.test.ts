import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Colleague, Turn } from "../colleague/types.js";
import { makeRuntime } from "./agent.js";
import type { MemoryEntry } from "./memory.js";
import {
  CodexAppServerError,
  CodexAppServerRuntime,
  type AppServerProcess,
} from "./codex-app-server.js";

type ProtocolMessage = {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
};

const GMAIL_CONNECTOR_ID = "connector_2128aebfecb84f64a069897515042a44";
const TEST_POLICY_OWNER = "owner@example.com";
const SAFE_APPROVED_SEND = {
  to: TEST_POLICY_OWNER,
  subject: "Re: Project update",
  body: "收到，謝謝。\n\nAda",
  content_type: "text/plain",
  reply_message_id: "18f0abc_DEF-123",
} as const;
const UNVERIFIED_GMAIL_SEND_TEXT =
  "尚未確認寄出：Codex app-server 沒有回報符合本回合 Gmail connector 的成功寄信工具結果，因此不能將這封信視為已寄出。";

const temporaryPolicyDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPolicyDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

class FakeAppServer extends EventEmitter implements AppServerProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly messages: ProtocolMessage[] = [];
  readonly kill = vi.fn(() => true);

  private inputBuffer = "";

  constructor(
    private readonly onMessage: (
      message: ProtocolMessage,
      server: FakeAppServer,
    ) => void,
  ) {
    super();
    this.stdin.setEncoding("utf8");
    this.stdin.once("finish", () =>
      queueMicrotask(() => this.emit("close", 0, null)),
    );
    this.stdin.on("data", (chunk: string) => {
      this.inputBuffer += chunk;
      let newline = this.inputBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.inputBuffer.slice(0, newline).trim();
        this.inputBuffer = this.inputBuffer.slice(newline + 1);
        if (line) {
          const message = JSON.parse(line) as ProtocolMessage;
          this.messages.push(message);
          queueMicrotask(() => this.onMessage(message, this));
        }
        newline = this.inputBuffer.indexOf("\n");
      }
    });
  }

  send(message: ProtocolMessage): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

const colleague: Colleague = {
  dir: "/tmp/ada",
  person: {
    id: "ada",
    name: "Ada",
    handle: "@ada",
    role: "Digital colleague",
    mandate: "Help the user with daily work.",
  },
  soul: { markdown: "Be warm and concise." },
  info: {
    accounts: {
      gmail: {
        provider: "gmail",
        address: "cathayaids@gmail.com",
        label: "Ada — Gmail inbox",
      },
    },
    channels: [{ kind: "web" }],
  },
  skills: [],
};

const history: MemoryEntry[] = [
  {
    at: "2026-07-14T10:00:00.000Z",
    threadId: "browser-thread",
    role: "human",
    text: "My name is Chris.",
  },
];

function turn(text: string): Turn {
  return {
    channel: "web",
    threadId: "browser-thread",
    from: "local-user",
    text,
    at: "2026-07-14T10:01:00.000Z",
  };
}

async function colleagueWithEmailPolicy(
  overrides: Record<string, unknown> = {},
): Promise<Colleague> {
  const dir = await mkdtemp(join(tmpdir(), "digital-colleague-email-policy-"));
  temporaryPolicyDirs.push(dir);
  await mkdir(join(dir, "policies"));
  await writeFile(
    join(dir, "policies", "email-automation.json"),
    JSON.stringify({
      version: 1,
      enabled: true,
      mode: "owner_only",
      mailbox: "cathayaids@gmail.com",
      allowedSenders: [TEST_POLICY_OWNER],
      allowedReplyKinds: ["acknowledgement"],
      requireSameThread: true,
      allowNewRecipients: false,
      allowCc: false,
      allowBcc: false,
      allowAttachments: false,
      maxRepliesPerMessage: 1,
      maxBodyCharacters: 2000,
      interruptible: true,
      escalateOn: [],
      ...overrides,
    }),
    "utf8",
  );
  return { ...colleague, dir };
}

function gmailApprovalParams(
  send: Record<string, unknown> = SAFE_APPROVED_SEND,
): Record<string, unknown> {
  return {
    threadId: "native-thread",
    turnId: "approval-bridge-turn-2",
    serverName: "codex_apps",
    mode: "form",
    message: "Allow Gmail to send this email?",
    requestedSchema: { type: "object", properties: {} },
    _meta: {
      codex_approval_kind: "mcp_tool_call",
      source: "connector",
      connector_id: GMAIL_CONNECTOR_ID,
      connector_name: "Gmail",
      tool_title: "send_email",
      tool_params_display: Object.entries(send).map(([name, value]) => ({
        name,
        display_name: name,
        value,
      })),
    },
  };
}

function gmailApprovalParamsWith(
  paramsOverrides: Record<string, unknown> = {},
  metaOverrides: Record<string, unknown> = {},
  send: Record<string, unknown> = SAFE_APPROVED_SEND,
): Record<string, unknown> {
  const base = gmailApprovalParams(send);
  return {
    ...base,
    ...paramsOverrides,
    _meta: {
      ...(isTestRecord(base._meta) ? base._meta : {}),
      ...metaOverrides,
    },
  };
}

function gmailSendToolItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const { appContext, ...topLevelOverrides } = overrides;
  const appContextOverride = isTestRecord(appContext)
    ? appContext
    : {};
  return {
    type: "mcpToolCall",
    id: "approved-gmail-send-tool",
    server: "codex_apps",
    tool: "gmail.send_email",
    status: "completed",
    arguments: { ...SAFE_APPROVED_SEND },
    pluginId: "gmail@openai-curated",
    result: { content: [], structuredContent: null, _meta: null },
    error: null,
    durationMs: 10,
    ...topLevelOverrides,
    appContext: {
      connectorId: GMAIL_CONNECTOR_ID,
      linkId: "gmail-link",
      resourceUri: null,
      appName: "Gmail",
      templateId: null,
      actionName: "send_email",
      ...appContextOverride,
    },
  };
}

function gmailDraftContract(
  send: Record<string, unknown> = SAFE_APPROVED_SEND,
): string {
  return (
    "模型描述不得成為核准內容。\n" +
    `<ada-gmail-draft>${JSON.stringify(send)}</ada-gmail-draft>`
  );
}

function gmailProfileToolItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const { appContext, ...topLevelOverrides } = overrides;
  return {
    type: "mcpToolCall",
    id: "gmail-profile-tool",
    server: "codex_apps",
    tool: "gmail.get_profile",
    status: "completed",
    arguments: {},
    result: {
      content: [],
      structuredContent: { email: "cathayaids@gmail.com" },
      _meta: null,
    },
    error: null,
    ...topLevelOverrides,
    appContext: {
      connectorId: GMAIL_CONNECTOR_ID,
      linkId: "gmail-link",
      appName: "Gmail",
      actionName: "get_profile",
      ...(isTestRecord(appContext) ? appContext : {}),
    },
  };
}

function gmailReadThreadToolItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const { appContext, ...topLevelOverrides } = overrides;
  return {
    type: "mcpToolCall",
    id: "gmail-read-thread-tool",
    server: "codex_apps",
    tool: "gmail.read_email_thread",
    status: "completed",
    arguments: {
      id: SAFE_APPROVED_SEND.reply_message_id,
      id_type: "message",
      max_messages: 3,
    },
    result: {
      content: [],
      structuredContent: {
        thread_id: "gmail-thread",
        messages: [
          {
            id: SAFE_APPROVED_SEND.reply_message_id,
            thread_id: "gmail-thread",
            from_: `Owner <${TEST_POLICY_OWNER}>`,
            to: ["Cathay AIDS <cathayaids@gmail.com>"],
          },
        ],
      },
      _meta: null,
    },
    error: null,
    ...topLevelOverrides,
    appContext: {
      connectorId: GMAIL_CONNECTOR_ID,
      linkId: "gmail-link",
      appName: "Gmail",
      actionName: "read_email_thread",
      ...(isTestRecord(appContext) ? appContext : {}),
    },
  };
}

function gmailReadThreadToolItemWithMessage(
  messageOverrides: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return gmailReadThreadToolItem({
    ...overrides,
    result: {
      content: [],
      structuredContent: {
        thread_id: "gmail-thread",
        messages: [
          {
            id: SAFE_APPROVED_SEND.reply_message_id,
            thread_id: "gmail-thread",
            from_: `Owner <${TEST_POLICY_OWNER}>`,
            to: ["Cathay AIDS <cathayaids@gmail.com>"],
            ...messageOverrides,
          },
        ],
      },
      _meta: null,
    },
  });
}

function isTestRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ApprovalBridgeScenario {
  draftRequestText?: string;
  approvalParams?: Record<string, unknown>;
  approvalText?: string;
  approvalExternalThreadId?: string;
  duplicateElicitation?: boolean;
  policyOverrides?: Record<string, unknown>;
  toolItem?: Record<string, unknown> | null;
  toolNotificationThreadId?: string;
  toolNotificationTurnId?: string;
  profileToolItem?: Record<string, unknown> | null;
  readThreadToolItem?: Record<string, unknown> | null;
}

async function runApprovalBridgeScenario(
  scenario: ApprovalBridgeScenario = {},
): Promise<{
  preview: { text: string };
  previewDeltas: string[];
  reply: { text: string };
  server: FakeAppServer;
  elicitationResponses: ProtocolMessage[];
}> {
  const testColleague = await colleagueWithEmailPolicy(scenario.policyOverrides);
  const firstRequestId = 9_101;
  const duplicateRequestId = 9_102;
  let turnNumber = 0;
  let waitingForDuplicate = false;
  const server = new FakeAppServer((message, fake) => {
    if (replyToHandshakeAndThread(message, fake, true)) return;
    if (message.method === "turn/start") {
      turnNumber += 1;
      const nativeTurnId = `approval-bridge-turn-${turnNumber}`;
      fake.send({
        id: message.id,
        result: { turn: { id: nativeTurnId, status: "inProgress" } },
      });
      if (turnNumber === 1) {
        sendCompletedAgentTurn(fake, nativeTurnId, gmailDraftContract());
      } else {
        for (const item of [
          scenario.profileToolItem === undefined
            ? gmailProfileToolItem()
            : scenario.profileToolItem,
          scenario.readThreadToolItem === undefined
            ? gmailReadThreadToolItem()
            : scenario.readThreadToolItem,
        ]) {
          if (item) {
            fake.send({
              method: "item/completed",
              params: {
                threadId: "native-thread",
                turnId: nativeTurnId,
                item,
              },
            });
          }
        }
        fake.send({
          id: firstRequestId,
          method: "mcpServer/elicitation/request",
          params: scenario.approvalParams ?? gmailApprovalParams(),
        });
      }
      return;
    }
    if (message.id === firstRequestId && message.method === undefined) {
      if (scenario.duplicateElicitation) {
        waitingForDuplicate = true;
        fake.send({
          id: duplicateRequestId,
          method: "mcpServer/elicitation/request",
          params: scenario.approvalParams ?? gmailApprovalParams(),
        });
        return;
      }
      sendApprovalTurnCompletion(fake, scenario);
      return;
    }
    if (
      waitingForDuplicate &&
      message.id === duplicateRequestId &&
      message.method === undefined
    ) {
      waitingForDuplicate = false;
      sendApprovalTurnCompletion(fake, scenario);
    }
  });
  const runtime = new CodexAppServerRuntime({
    startProcess: () => server,
    timeoutMs: 500,
  });
  try {
    const previewDeltas: string[] = [];
    const preview = await runtime.respond(
      testColleague,
      [],
      turn(
        scenario.draftRequestText ??
          `請用 Gmail 回信給 ${TEST_POLICY_OWNER}，先給我草稿再等我確認。`,
      ),
      (delta) => previewDeltas.push(delta),
    );
    const reply = await runtime.respond(testColleague, [], {
      ...turn(scenario.approvalText ?? "確認寄出"),
      threadId: scenario.approvalExternalThreadId ?? "browser-thread",
    });
    return {
      preview,
      previewDeltas,
      reply,
      server,
      elicitationResponses: server.messages.filter(
        (message) =>
          (message.id === firstRequestId || message.id === duplicateRequestId) &&
          message.method === undefined,
      ),
    };
  } finally {
    await runtime.close();
  }
}

function sendCompletedAgentTurn(
  server: FakeAppServer,
  turnId: string,
  text: string,
): void {
  server.send({
    method: "item/completed",
    params: {
      threadId: "native-thread",
      turnId,
      item: {
        type: "agentMessage",
        id: `${turnId}-message`,
        text,
        phase: "final_answer",
      },
    },
  });
  server.send({
    method: "turn/completed",
    params: {
      threadId: "native-thread",
      turn: { id: turnId, status: "completed", items: [] },
    },
  });
}

function sendApprovalTurnCompletion(
  server: FakeAppServer,
  scenario: ApprovalBridgeScenario,
): void {
  if (scenario.toolItem !== null) {
    server.send({
      method: "item/completed",
      params: {
        threadId: scenario.toolNotificationThreadId ?? "native-thread",
        turnId: scenario.toolNotificationTurnId ?? "approval-bridge-turn-2",
        item: scenario.toolItem ?? gmailSendToolItem(),
      },
    });
  }
  sendCompletedAgentTurn(server, "approval-bridge-turn-2", "已成功寄出郵件。");
}

function replyToHandshakeAndThread(
  message: ProtocolMessage,
  server: FakeAppServer,
  appAccessible = false,
): boolean {
  if (message.method === "initialize") {
    server.send({
      id: message.id,
      result: {
        userAgent: "codex-test",
        codexHome: "/tmp/codex",
        platformFamily: "unix",
        platformOs: "macos",
      },
    });
    return true;
  }
  if (message.method === "thread/start") {
    server.send({ id: message.id, result: { thread: { id: "native-thread" } } });
    return true;
  }
  if (message.method === "skills/list") {
    server.send({
      id: message.id,
      result: {
        data: [
          {
            cwd: colleague.dir,
            errors: [],
            skills: [
              {
                name: "computer-use:computer-use",
                description: "Control local Mac apps through Computer Use.",
                enabled: true,
                path: "/tmp/codex/plugins/computer-use/skills/computer-use/SKILL.md",
                scope: "user",
              },
            ],
          },
        ],
      },
    });
    return true;
  }
  if (message.method === "plugin/installed") {
    server.send({
      id: message.id,
      result: {
        marketplaces: [
          {
            name: "openai-curated",
            path: "/tmp/codex/openai-curated/.agents/plugins/marketplace.json",
            plugins: [
              {
                id: "gmail@openai-curated",
                name: "gmail",
                installed: true,
                enabled: true,
                authPolicy: "ON_INSTALL",
                installPolicy: "AVAILABLE",
                source: { type: "local", path: "/tmp/codex/plugins/gmail" },
              },
            ],
          },
        ],
      },
    });
    return true;
  }
  if (message.method === "plugin/read") {
    server.send({
      id: message.id,
      result: {
        plugin: {
          marketplaceName: "openai-curated",
          marketplacePath:
            "/tmp/codex/openai-curated/.agents/plugins/marketplace.json",
          apps: [
            {
              id: "connector_2128aebfecb84f64a069897515042a44",
              name: "Gmail",
              installUrl:
                "https://chatgpt.com/apps/gmail/connector_2128aebfecb84f64a069897515042a44",
            },
          ],
          skills: [
            {
              name: "gmail:gmail",
              path: "/tmp/codex/plugins/gmail/skills/gmail/SKILL.md",
              enabled: true,
            },
            {
              name: "gmail:gmail-inbox-triage",
              path: "/tmp/codex/plugins/gmail/skills/gmail-inbox-triage/SKILL.md",
              enabled: true,
            },
          ],
        },
      },
    });
    return true;
  }
  if (message.method === "app/list") {
    if (message.params?.cursor === null) {
      server.send({
        id: message.id,
        result: {
          data: [
            {
              id: "unrelated-app",
              name: "Unrelated App",
              isAccessible: false,
              isEnabled: true,
            },
          ],
          nextCursor: "gmail-page",
        },
      });
      return true;
    }
    server.send({
      id: message.id,
      result: {
        data: [
          {
            id: "connector_2128aebfecb84f64a069897515042a44",
            name: "Gmail",
            installUrl:
              "https://chatgpt.com/apps/gmail/connector_2128aebfecb84f64a069897515042a44",
            isAccessible: appAccessible,
            isEnabled: true,
          },
        ],
        nextCursor: null,
      },
    });
    return true;
  }
  return message.method === "initialized";
}

describe("CodexAppServerRuntime", () => {
  it("is the Codex runtime selected by the existing runtime factory", async () => {
    const runtime = makeRuntime("codex");
    expect(runtime).toBeInstanceOf(CodexAppServerRuntime);
    expect(runtime.name).toBe("codex-app-server");
    await runtime.close?.();
  });

  it("rejects an unsupported reasoning effort before starting Codex", () => {
    expect(
      () =>
        new CodexAppServerRuntime({
          reasoningEffort: "fast" as never,
        }),
    ).toThrow("CODEX_REASONING_EFFORT must be one of");
  });

  it("uses Codex account/read and managed login without accepting credentials", async () => {
    const server = new FakeAppServer((message, fake) => {
      if (replyToHandshakeAndThread(message, fake)) return;
      if (message.method === "account/read") {
        fake.send({
          id: message.id,
          result: {
            account: {
              type: "chatgpt",
              email: "shared-codex@example.com",
              planType: "plus",
            },
            requiresOpenaiAuth: true,
          },
        });
      }
      if (message.method === "account/login/start") {
        fake.send({
          id: message.id,
          result: {
            type: "chatgpt",
            loginId: "login-1",
            authUrl: "https://auth.openai.com/authorize",
          },
        });
      }
    });
    const runtime = new CodexAppServerRuntime({ startProcess: () => server });

    await expect(runtime.readAccount()).resolves.toEqual({
      available: true,
      requiresOpenaiAuth: true,
      account: { type: "chatgpt", email: "shared-codex@example.com" },
    });
    await expect(runtime.startLogin("chatgpt")).resolves.toEqual({
      type: "chatgpt",
      loginId: "login-1",
      authUrl: "https://auth.openai.com/authorize",
    });
    expect(
      server.messages.find((message) => message.method === "account/login/start")?.params,
    ).toEqual({
      type: "chatgpt",
      codexStreamlinedLogin: true,
      useHostedLoginSuccessPage: true,
      appBrand: "codex",
    });
    await runtime.close();
  });

  it("uses the native initialize, thread/start and turn/start protocol", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    let turnNumber = 0;
    const server = new FakeAppServer((message, fake) => {
      if (replyToHandshakeAndThread(message, fake, true)) return;
      if (message.method === "turn/start") {
        turnNumber += 1;
        const nativeTurnId = `native-turn-${turnNumber}`;
        fake.send({
          id: message.id,
          result: { turn: { id: nativeTurnId, status: "inProgress" } },
        });
        fake.send({
          method: "item/completed",
          params: {
            threadId: "native-thread",
            turnId: nativeTurnId,
            completedAtMs: Date.now(),
            item: {
              type: "agentMessage",
              id: `message-${turnNumber}`,
              text: turnNumber === 1 ? "Hello Chris." : "Still here.",
              phase: "final_answer",
              memoryCitation: null,
            },
          },
        });
        fake.send({
          method: "turn/completed",
          params: {
            threadId: "native-thread",
            turn: {
              id: nativeTurnId,
              status: "completed",
              items: [],
              error: null,
            },
          },
        });
      }
    });
    const runtime = new CodexAppServerRuntime({
      startProcess: () => server,
      timeoutMs: 250,
    });

    await expect(
      runtime.respond(colleague, history, turn("幫我看看最近有哪些信需要處理")),
    ).resolves.toEqual({ text: "Hello Chris." });
    now.mockReturnValue(16_001);
    await expect(
      runtime.respond(colleague, history, turn("再看看還有哪些信需要處理")),
    ).resolves.toEqual({ text: "Still here." });
    now.mockRestore();

    const initialize = server.messages.find((message) => message.method === "initialize");
    expect(initialize?.params).toEqual({
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
    expect(server.messages.some((message) => message.method === "initialized")).toBe(true);

    const starts = server.messages.filter((message) => message.method === "thread/start");
    expect(starts).toHaveLength(1);
    expect(starts[0]?.params).toMatchObject({
      cwd: colleague.dir,
      approvalPolicy: "never",
      sandbox: "read-only",
      effort: "low",
      ephemeral: true,
    });
    expect(starts[0]?.params?.developerInstructions).toContain("You are Ada");
    expect(starts[0]?.params?.developerInstructions).toContain(
      "gmail as cathayaids@gmail.com",
    );
    expect(starts[0]?.params?.developerInstructions).toContain(
      "The Codex login is the runtime control account and may differ",
    );
    expect(starts[0]?.params?.developerInstructions).toContain(
      "NATIVE CAPABILITY SNAPSHOT",
    );
    expect(starts[0]?.params?.baseInstructions).toBeUndefined();

    expect(
      server.messages.filter((message) => message.method === "skills/list"),
    ).toHaveLength(0);

    const installedPlugins = server.messages.filter(
      (message) => message.method === "plugin/installed",
    );
    expect(installedPlugins).toHaveLength(1);
    expect(installedPlugins[0]?.params).toEqual({ cwds: [colleague.dir] });
    const pluginReads = server.messages.filter(
      (message) => message.method === "plugin/read",
    );
    expect(pluginReads).toHaveLength(1);
    expect(pluginReads[0]?.params).toEqual({
      marketplacePath:
        "/tmp/codex/openai-curated/.agents/plugins/marketplace.json",
      pluginName: "gmail",
    });
    const appLists = server.messages.filter(
      (message) => message.method === "app/list",
    );
    expect(appLists).toHaveLength(2);
    expect(appLists[0]?.params).toEqual({
      cursor: null,
      limit: 100,
      threadId: "native-thread",
      forceRefetch: false,
    });
    expect(appLists[1]?.params).toEqual({
      cursor: "gmail-page",
      limit: 100,
      threadId: "native-thread",
      forceRefetch: false,
    });

    const turns = server.messages.filter((message) => message.method === "turn/start");
    expect(turns).toHaveLength(2);
    expect(turns[0]?.params).toMatchObject({
      threadId: "native-thread",
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      effort: "low",
    });
    expect(JSON.stringify(turns[0]?.params)).toContain("My name is Chris.");
    expect(JSON.stringify(turns[1]?.params)).not.toContain("My name is Chris.");
    expect(turns[0]?.params?.input).toEqual(
      expect.arrayContaining([
        {
          type: "skill",
          name: "gmail:gmail-inbox-triage",
          path: "/tmp/codex/plugins/gmail/skills/gmail-inbox-triage/SKILL.md",
        },
        {
          type: "mention",
          name: "Gmail",
          path: "plugin://gmail@openai-curated",
        },
        {
          type: "mention",
          name: "Gmail",
          path: "app://connector_2128aebfecb84f64a069897515042a44",
        },
      ]),
    );
    expect(JSON.stringify(turns[0]?.params?.input)).toContain(
      "Gmail plugin：已安裝並啟用",
    );
    expect(JSON.stringify(turns[0]?.params?.input)).toContain(
      "Gmail connector：帳號已連線，可在本回合叫用",
    );
    expect(JSON.stringify(turns[0]?.params?.input)).toContain(
      "不得說 Gmail plugin 尚未安裝",
    );
    expect(JSON.stringify(turns[0]?.params?.input)).toContain(
      "@gmail $gmail $gmail-inbox-triage",
    );
    await runtime.close();
  });

  it.each(["批准寄出", "確認寄出"])(
    "carries the Gmail connector for one immutable same-thread draft approval: %s",
    async (approvalText) => {
      let turnNumber = 0;
      const server = new FakeAppServer((message, fake) => {
        if (replyToHandshakeAndThread(message, fake, true)) return;
        if (message.method === "turn/start") {
          turnNumber += 1;
          const nativeTurnId = `gmail-approval-turn-${turnNumber}`;
          fake.send({
            id: message.id,
            result: { turn: { id: nativeTurnId, status: "inProgress" } },
          });
          fake.send({
            method: "item/completed",
            params: {
              threadId: "native-thread",
              turnId: nativeTurnId,
              item: {
                type: "agentMessage",
                id: `gmail-approval-message-${turnNumber}`,
                text:
                  turnNumber === 1
                    ? gmailDraftContract()
                    : "尚未透過正式核准橋接寄出。",
                phase: "final_answer",
              },
            },
          });
          fake.send({
            method: "turn/completed",
            params: {
              threadId: "native-thread",
              turn: { id: nativeTurnId, status: "completed", items: [] },
            },
          });
        }
      });
      const runtime = new CodexAppServerRuntime({
        startProcess: () => server,
        timeoutMs: 250,
      });
      const policyColleague = await colleagueWithEmailPolicy();

      await runtime.respond(
        policyColleague,
        [],
        turn(`請用 Gmail 回信給 ${TEST_POLICY_OWNER}，先給我草稿再等我確認。`),
      );
      await runtime.respond(policyColleague, [], turn(approvalText));
      const replay = await runtime.respond(policyColleague, [], turn(approvalText));

      const turns = server.messages.filter(
        (message) => message.method === "turn/start",
      );
      expect(turns).toHaveLength(2);
      expect(JSON.stringify(turns[1]?.params?.input)).toContain(
        "app://connector_2128aebfecb84f64a069897515042a44",
      );
      expect(JSON.stringify(turns[1]?.params?.input)).toContain(approvalText);
      expect(JSON.stringify(turns[1]?.params?.input)).toContain(
        SAFE_APPROVED_SEND.reply_message_id,
      );
      expect(JSON.stringify(turns[1]?.params?.input)).toContain(TEST_POLICY_OWNER);
      expect(replay.text).toContain(
        "目前沒有一份已顯示且等待核准的 Gmail 草稿",
      );
      const appLists = server.messages.filter(
        (message) => message.method === "app/list",
      );
      expect(appLists.some((message) => message.params?.forceRefetch === true)).toBe(
        true,
      );
      await runtime.close();
    },
  );

  it("force-refreshes a transient Gmail binding on exact same-thread approval", async () => {
    let appListCount = 0;
    let turnNumber = 0;
    const server = new FakeAppServer((message, fake) => {
      if (message.method === "plugin/read") {
        fake.send({
          id: message.id,
          error: { code: -32603, message: "remote plugin detail unavailable" },
        });
        return;
      }
      if (message.method === "app/list") {
        appListCount += 1;
        fake.send({
          id: message.id,
          result: {
            data: [
              {
                id: GMAIL_CONNECTOR_ID,
                name: "Gmail",
                isAccessible: true,
                isEnabled: true,
              },
            ],
            nextCursor: null,
          },
        });
        return;
      }
      if (replyToHandshakeAndThread(message, fake)) return;
      if (message.method === "turn/start") {
        turnNumber += 1;
        const nativeTurnId = `transient-binding-turn-${turnNumber}`;
        fake.send({
          id: message.id,
          result: { turn: { id: nativeTurnId, status: "inProgress" } },
        });
        fake.send({
          method: "item/completed",
          params: {
            threadId: "native-thread",
            turnId: nativeTurnId,
            item: {
              type: "agentMessage",
              id: `transient-binding-message-${turnNumber}`,
              text: turnNumber === 1 ? gmailDraftContract() : "尚未寄出。",
              phase: "final_answer",
            },
          },
        });
        fake.send({
          method: "turn/completed",
          params: {
            threadId: "native-thread",
            turn: { id: nativeTurnId, status: "completed", items: [] },
          },
        });
      }
    });
    const policyColleague = await colleagueWithEmailPolicy();
    const runtime = new CodexAppServerRuntime({
      startProcess: () => server,
      timeoutMs: 250,
    });

    await runtime.respond(
      policyColleague,
      [],
      turn("請用 Gmail 回信給 owner@example.com，先給我草稿再等我批准寄出。"),
    );
    await runtime.respond(policyColleague, [], turn("批准寄出"));

    const turns = server.messages.filter(
      (message) => message.method === "turn/start",
    );
    expect(appListCount).toBe(2);
    expect(
      server.messages.filter((message) => message.method === "app/list")[1]
        ?.params?.forceRefetch,
    ).toBe(true);
    expect(JSON.stringify(turns[1]?.params?.input)).toContain(
      `app://${GMAIL_CONNECTOR_ID}`,
    );
    await runtime.close();
  });

  it.each(["可以", "今天天氣如何", "確認寄出！"])(
    "clears a pending Gmail continuation after an intervening turn: %s",
    async (interveningText) => {
      let turnNumber = 0;
      const server = new FakeAppServer((message, fake) => {
        if (replyToHandshakeAndThread(message, fake, true)) return;
        if (message.method === "turn/start") {
          turnNumber += 1;
          const nativeTurnId = `intervening-turn-${turnNumber}`;
          fake.send({
            id: message.id,
            result: { turn: { id: nativeTurnId, status: "inProgress" } },
          });
          fake.send({
            method: "item/completed",
            params: {
              threadId: "native-thread",
              turnId: nativeTurnId,
              item: {
                type: "agentMessage",
                id: `intervening-message-${turnNumber}`,
                text: turnNumber === 1 ? gmailDraftContract() : "收到。",
                phase: "final_answer",
              },
            },
          });
          fake.send({
            method: "turn/completed",
            params: {
              threadId: "native-thread",
              turn: { id: nativeTurnId, status: "completed", items: [] },
            },
          });
        }
      });
      const runtime = new CodexAppServerRuntime({
        startProcess: () => server,
        timeoutMs: 250,
      });
      const policyColleague = await colleagueWithEmailPolicy();

      await runtime.respond(
        policyColleague,
        [],
        turn(`請用 Gmail 回信給 ${TEST_POLICY_OWNER}，先給我草稿再等我確認。`),
      );
      await runtime.respond(policyColleague, [], turn(interveningText));
      const expired = await runtime.respond(
        policyColleague,
        [],
        turn("確認寄出"),
      );

      const turns = server.messages.filter(
        (message) => message.method === "turn/start",
      );
      expect(turns).toHaveLength(2);
      expect(JSON.stringify(turns[1]?.params?.input)).not.toContain(
        "app://connector_2128aebfecb84f64a069897515042a44",
      );
      expect(expired.text).toContain(
        "目前沒有一份已顯示且等待核准的 Gmail 草稿",
      );
      await runtime.close();
    },
  );

  it("does not carry a pending Gmail continuation into another external thread", async () => {
    let turnNumber = 0;
    const server = new FakeAppServer((message, fake) => {
      if (replyToHandshakeAndThread(message, fake, true)) return;
      if (message.method === "turn/start") {
        turnNumber += 1;
        const nativeTurnId = `isolated-turn-${turnNumber}`;
        fake.send({
          id: message.id,
          result: { turn: { id: nativeTurnId, status: "inProgress" } },
        });
        fake.send({
          method: "item/completed",
          params: {
            threadId: "native-thread",
            turnId: nativeTurnId,
            item: {
              type: "agentMessage",
              id: `isolated-message-${turnNumber}`,
              text: gmailDraftContract(),
              phase: "final_answer",
            },
          },
        });
        fake.send({
          method: "turn/completed",
          params: {
            threadId: "native-thread",
            turn: { id: nativeTurnId, status: "completed", items: [] },
          },
        });
      }
    });
    const runtime = new CodexAppServerRuntime({
      startProcess: () => server,
      timeoutMs: 250,
    });
    const policyColleague = await colleagueWithEmailPolicy();

    await runtime.respond(
      policyColleague,
      [],
      turn(`請用 Gmail 回信給 ${TEST_POLICY_OWNER}，先給我草稿再等我確認。`),
    );
    const isolated = await runtime.respond(policyColleague, [], {
      ...turn("確認寄出"),
      threadId: "another-browser-thread",
    });

    const turns = server.messages.filter(
      (message) => message.method === "turn/start",
    );
    expect(turns).toHaveLength(1);
    expect(isolated.text).toContain(
      "目前沒有一份已顯示且等待核准的 Gmail 草稿",
    );
    await runtime.close();
  });

  it("accepts one policy-bound Gmail send approval and declines a duplicate", async () => {
    const { reply, elicitationResponses } = await runApprovalBridgeScenario({
      duplicateElicitation: true,
    });

    expect(elicitationResponses).toEqual([
      {
        id: 9_101,
        result: { action: "accept", content: null, _meta: null },
      },
      {
        id: 9_102,
        result: { action: "decline", content: null, _meta: null },
      },
    ]);
    expect(reply).toEqual({ text: "已成功寄出郵件。" });
  });

  it("renders the immutable runtime draft instead of model-authored preview prose", async () => {
    const { preview, previewDeltas } = await runApprovalBridgeScenario();

    expect(preview.text).toContain("Gmail 回覆草稿（核准後只會照這份內容寄出）");
    expect(preview.text).toContain('"mailbox": "cathayaids@gmail.com"');
    expect(preview.text).toContain(`"to": "${TEST_POLICY_OWNER}"`);
    expect(preview.text).toContain(`"subject": "${SAFE_APPROVED_SEND.subject}"`);
    expect(preview.text).toContain(JSON.stringify(SAFE_APPROVED_SEND.body).slice(1, -1));
    expect(preview.text).toContain(SAFE_APPROVED_SEND.reply_message_id);
    expect(preview.text).not.toContain("模型描述不得成為核准內容");
    expect(preview.text).not.toContain("ada-gmail-draft");
    expect(previewDeltas).toEqual([preview.text]);
  });

  it.each([
    `請答覆 ${TEST_POLICY_OWNER} 的郵件`,
    `請回應 ${TEST_POLICY_OWNER} 的郵件`,
    `回覆 ${TEST_POLICY_OWNER} 那封信`,
  ])("routes the natural reply request through immutable draft capture: %s", async (text) => {
    const { preview } = await runApprovalBridgeScenario({ draftRequestText: text });

    expect(preview.text).toContain("Gmail 回覆草稿（核准後只會照這份內容寄出）");
    expect(preview.text).not.toContain("ada-gmail-draft");
  });

  it.each([
    {
      name: "subject",
      send: { ...SAFE_APPROVED_SEND, subject: "Re: Different approved-looking subject" },
    },
    {
      name: "body",
      send: { ...SAFE_APPROVED_SEND, body: "不同但仍在 policy 長度內的正文" },
    },
    {
      name: "recipient",
      send: { ...SAFE_APPROVED_SEND, to: "other-owner@example.com" },
    },
    {
      name: "original message id",
      send: { ...SAFE_APPROVED_SEND, reply_message_id: "another-valid-message-id" },
    },
  ])("declines when the connector mutates the displayed $name", async ({ send }) => {
    const { elicitationResponses, reply } = await runApprovalBridgeScenario({
      approvalParams: gmailApprovalParams(send),
      policyOverrides:
        send.to === "other-owner@example.com"
          ? { allowedSenders: [TEST_POLICY_OWNER, "other-owner@example.com"] }
          : undefined,
      toolItem: null,
    });

    expect(elicitationResponses).toEqual([
      {
        id: 9_101,
        result: { action: "decline", content: null, _meta: null },
      },
    ]);
    expect(reply.text).toContain(UNVERIFIED_GMAIL_SEND_TEXT);
  });

  it.each([
    {
      name: "profile evidence is missing",
      scenario: { profileToolItem: null },
    },
    {
      name: "profile mailbox differs",
      scenario: {
        profileToolItem: gmailProfileToolItem({
          result: {
            content: [],
            structuredContent: { email: "other@gmail.com" },
            _meta: null,
          },
        }),
      },
    },
    {
      name: "profile connector differs",
      scenario: {
        profileToolItem: gmailProfileToolItem({
          appContext: { connectorId: "other-connector" },
        }),
      },
    },
    {
      name: "profile arguments are not empty",
      scenario: { profileToolItem: gmailProfileToolItem({ arguments: { unsafe: true } }) },
    },
    {
      name: "original message evidence is missing",
      scenario: { readThreadToolItem: null },
    },
    {
      name: "profile and read use different connector links",
      scenario: {
        readThreadToolItem: gmailReadThreadToolItem({
          appContext: { linkId: "another-gmail-link" },
        }),
      },
    },
    {
      name: "original message sender differs",
      scenario: {
        readThreadToolItem: gmailReadThreadToolItemWithMessage({
          from_: "Attacker <attacker@example.com>",
        }),
      },
    },
    {
      name: "original message mailbox recipient differs",
      scenario: {
        readThreadToolItem: gmailReadThreadToolItemWithMessage({
          to: ["Other <other@gmail.com>"],
        }),
      },
    },
    {
      name: "original message id differs",
      scenario: {
        readThreadToolItem: gmailReadThreadToolItemWithMessage({
          id: "another-valid-message-id",
        }),
      },
    },
    {
      name: "read lookup does not identify a message",
      scenario: {
        readThreadToolItem: gmailReadThreadToolItem({
          arguments: {
            id: SAFE_APPROVED_SEND.reply_message_id,
            id_type: "thread",
            max_messages: 3,
          },
        }),
      },
    },
    {
      name: "read lookup contains an extra argument",
      scenario: {
        readThreadToolItem: gmailReadThreadToolItem({
          arguments: {
            id: SAFE_APPROVED_SEND.reply_message_id,
            id_type: "message",
            max_messages: 3,
            include_spam: true,
          },
        }),
      },
    },
  ])("declines approval when $name", async ({ scenario }) => {
    const { elicitationResponses, reply } = await runApprovalBridgeScenario({
      ...scenario,
      toolItem: null,
    });

    expect(elicitationResponses).toEqual([
      {
        id: 9_101,
        result: { action: "decline", content: null, _meta: null },
      },
    ]);
    expect(reply.text).toContain(UNVERIFIED_GMAIL_SEND_TEXT);
  });

  it.each([
    {
      name: "the chat confirmation is not exact",
      scenario: () => ({ approvalText: "可以" }),
      expectWarning: false,
    },
    {
      name: "the external thread differs",
      scenario: () => ({ approvalExternalThreadId: "another-browser-thread" }),
      expectWarning: false,
      expectElicitation: false,
    },
    {
      name: "the owner-only policy is disabled",
      scenario: () => ({ policyOverrides: { enabled: false } }),
      expectWarning: false,
      expectElicitation: false,
    },
    {
      name: "the policy mode is not owner_only",
      scenario: () => ({ policyOverrides: { mode: "manual" } }),
      expectWarning: false,
      expectElicitation: false,
    },
    {
      name: "the policy body limit exceeds the supported safety cap",
      scenario: () => ({ policyOverrides: { maxBodyCharacters: 2_001 } }),
      expectWarning: false,
      expectElicitation: false,
    },
    {
      name: "the native thread id differs",
      scenario: () => ({
        approvalParams: gmailApprovalParamsWith({ threadId: "foreign-native-thread" }),
      }),
    },
    {
      name: "the native turn id differs",
      scenario: () => ({
        approvalParams: gmailApprovalParamsWith({ turnId: "foreign-turn" }),
      }),
    },
    {
      name: "the connector id differs",
      scenario: () => ({
        approvalParams: gmailApprovalParamsWith({}, { connector_id: "other-connector" }),
      }),
    },
    {
      name: "the request is not from codex_apps",
      scenario: () => ({
        approvalParams: gmailApprovalParamsWith({ serverName: "other_mcp" }),
      }),
    },
    {
      name: "the request is not a form",
      scenario: () => ({
        approvalParams: gmailApprovalParamsWith({ mode: "url" }),
      }),
    },
    {
      name: "the requested schema is not the empty object schema",
      scenario: () => ({
        approvalParams: gmailApprovalParamsWith({
          requestedSchema: {
            type: "object",
            properties: { approve: { type: "boolean" } },
          },
        }),
      }),
    },
    {
      name: "the MCP approval metadata is incomplete",
      scenario: () => ({
        approvalParams: gmailApprovalParamsWith(
          {},
          { codex_approval_kind: "generic", source: "other" },
        ),
      }),
    },
    {
      name: "the connector or tool display identity differs",
      scenario: () => ({
        approvalParams: gmailApprovalParamsWith(
          {},
          { connector_name: "Not Gmail", tool_title: "draft_email" },
        ),
      }),
    },
    {
      name: "tool_params_display contains an extra field",
      scenario: () => {
        const params = gmailApprovalParamsWith();
        const meta = params._meta as Record<string, unknown>;
        meta.tool_params_display = [
          ...((meta.tool_params_display as unknown[]) ?? []),
          { name: "cc", value: "attacker@example.com" },
        ];
        return { approvalParams: params };
      },
    },
    {
      name: "the recipient is not allowlisted by policy",
      scenario: () => ({
        approvalParams: gmailApprovalParams({
          ...SAFE_APPROVED_SEND,
          to: "stranger@example.com",
        }),
      }),
    },
    {
      name: "the body exceeds the policy limit",
      scenario: () => ({
        policyOverrides: { maxBodyCharacters: 5 },
      }),
      expectWarning: false,
      expectElicitation: false,
    },
    {
      name: "the content type is not text/plain",
      scenario: () => ({
        approvalParams: gmailApprovalParams({
          ...SAFE_APPROVED_SEND,
          content_type: "text/html",
        }),
      }),
    },
    {
      name: "the reply message id is invalid",
      scenario: () => ({
        approvalParams: gmailApprovalParams({
          ...SAFE_APPROVED_SEND,
          reply_message_id: "bad id\nsecond-header",
        }),
      }),
    },
    {
      name: "the subject contains CRLF header injection",
      scenario: () => ({
        approvalParams: gmailApprovalParams({
          ...SAFE_APPROVED_SEND,
          subject: "Hello\r\nBcc: attacker@example.com",
        }),
      }),
    },
    {
      name: "the body contains a control character",
      scenario: () => ({
        approvalParams: gmailApprovalParams({
          ...SAFE_APPROVED_SEND,
          body: "hello\u0000world",
        }),
      }),
    },
  ])("declines Gmail approval when $name", async ({
    scenario,
    expectWarning = true,
    expectElicitation = true,
  }) => {
    const { reply, elicitationResponses } = await runApprovalBridgeScenario({
      ...scenario(),
      toolItem: null,
    });

    expect(elicitationResponses).toEqual(
      expectElicitation
        ? [
            {
              id: 9_101,
              result: { action: "decline", content: null, _meta: null },
            },
          ]
        : [],
    );
    if (expectWarning) expect(reply.text).toContain(UNVERIFIED_GMAIL_SEND_TEXT);
  });

  it.each([
    {
      name: "there is no completed tool item",
      scenario: () => ({ toolItem: null }),
    },
    {
      name: "the notification native thread differs",
      scenario: () => ({ toolNotificationThreadId: "foreign-native-thread" }),
    },
    {
      name: "the notification turn differs",
      scenario: () => ({ toolNotificationTurnId: "foreign-turn" }),
    },
    {
      name: "the MCP server differs",
      scenario: () => ({ toolItem: gmailSendToolItem({ server: "other_mcp" }) }),
    },
    {
      name: "the exact tool differs",
      scenario: () => ({ toolItem: gmailSendToolItem({ tool: "prepare_send_email" }) }),
    },
    {
      name: "the exact action differs",
      scenario: () => ({
        toolItem: gmailSendToolItem({
          appContext: { actionName: "draft_send_email" },
        }),
      }),
    },
    {
      name: "the connector differs",
      scenario: () => ({
        toolItem: gmailSendToolItem({
          appContext: { connectorId: "other-connector" },
        }),
      }),
    },
    {
      name: "the verified Gmail link differs",
      scenario: () => ({
        toolItem: gmailSendToolItem({
          appContext: { linkId: "another-gmail-link" },
        }),
      }),
    },
    {
      name: "the recipient arguments differ",
      scenario: () => ({
        toolItem: gmailSendToolItem({
          arguments: { ...SAFE_APPROVED_SEND, to: "stranger@example.com" },
        }),
      }),
    },
    {
      name: "the subject arguments differ",
      scenario: () => ({
        toolItem: gmailSendToolItem({
          arguments: { ...SAFE_APPROVED_SEND, subject: "Different subject" },
        }),
      }),
    },
    {
      name: "the body arguments differ",
      scenario: () => ({
        toolItem: gmailSendToolItem({
          arguments: { ...SAFE_APPROVED_SEND, body: "Different body" },
        }),
      }),
    },
    {
      name: "the reply message id arguments differ",
      scenario: () => ({
        toolItem: gmailSendToolItem({
          arguments: { ...SAFE_APPROVED_SEND, reply_message_id: "other-message" },
        }),
      }),
    },
    {
      name: "the result is missing",
      scenario: () => ({ toolItem: gmailSendToolItem({ result: null }) }),
    },
    {
      name: "the completed item contains an error",
      scenario: () => ({
        toolItem: gmailSendToolItem({ error: { message: "send failed" } }),
      }),
    },
  ])("does not preserve a Gmail success claim when $name", async ({ scenario }) => {
    const { reply, elicitationResponses } = await runApprovalBridgeScenario(scenario());

    expect(elicitationResponses[0]).toEqual({
      id: 9_101,
      result: { action: "accept", content: null, _meta: null },
    });
    expect(reply.text).toContain(UNVERIFIED_GMAIL_SEND_TEXT);
    expect(reply.text).not.toBe("已成功寄出郵件。");
  });

  it.each([
    {
      name: "Codex-tagged MCP tool approval",
      params: {
        threadId: "native-thread",
        turnId: "elicitation-turn",
        serverName: "codex_apps",
        mode: "form",
        message: "Allow Gmail to send this email?",
        _meta: {
          codex_approval_kind: "mcp_tool_call",
          source: "connector",
          connector_id: "connector_2128aebfecb84f64a069897515042a44",
        },
        requestedSchema: { type: "object", properties: {} },
      },
    },
    {
      name: "unsupported generic elicitation",
      params: {
        threadId: "native-thread",
        turnId: "elicitation-turn",
        serverName: "unknown_mcp",
        mode: "form",
        message: "Choose a template",
        _meta: {},
        requestedSchema: {
          type: "object",
          properties: {
            template: { type: "string", enum: ["simple", "fancy"] },
          },
        },
      },
    },
  ])("does not even start $name without a displayed pending draft", async ({ params }) => {
    const serverRequestId = 9_001;
    const server = new FakeAppServer((message, fake) => {
      if (replyToHandshakeAndThread(message, fake)) return;
      if (message.method === "turn/start") {
        fake.send({
          id: message.id,
          result: { turn: { id: "elicitation-turn", status: "inProgress" } },
        });
        fake.send({
          id: serverRequestId,
          method: "mcpServer/elicitation/request",
          params,
        });
        return;
      }
      if (message.id === serverRequestId && message.method === undefined) {
        fake.send({
          method: "item/completed",
          params: {
            threadId: "native-thread",
            turnId: "elicitation-turn",
            item: {
              type: "agentMessage",
              id: "elicitation-message",
              text: "尚未寄出。",
              phase: "final_answer",
            },
          },
        });
        fake.send({
          method: "turn/completed",
          params: {
            threadId: "native-thread",
            turn: { id: "elicitation-turn", status: "completed", items: [] },
          },
        });
      }
    });
    const runtime = new CodexAppServerRuntime({
      startProcess: () => server,
      timeoutMs: 250,
    });

    await expect(
      runtime.respond(colleague, [], turn("確認寄出")),
    ).resolves.toEqual({
      text: expect.stringContaining(
        "目前沒有一份已顯示且等待核准的 Gmail 草稿",
      ),
    });
    const response = server.messages.find(
      (message) => message.id === serverRequestId && message.method === undefined,
    );
    expect(response).toBeUndefined();
    expect(server.messages.filter((message) => message.method === "turn/start")).toHaveLength(
      0,
    );
    expect(params).toBeDefined();
    await runtime.close();
  });

  it.each([
    { name: "missing tool evidence", toolItem: undefined },
    {
      name: "failed Gmail tool evidence",
      toolItem: {
        type: "mcpToolCall",
        id: "gmail-send-tool",
        server: "codex_apps",
        tool: "send_email",
        status: "failed",
        arguments: { to: "alice@example.com" },
        appContext: {
          connectorId: "connector_2128aebfecb84f64a069897515042a44",
          linkId: null,
          resourceUri: null,
          appName: "Gmail",
          templateId: null,
          actionName: "send_email",
        },
        pluginId: "gmail@openai-curated",
        result: null,
        error: { message: "send failed" },
        durationMs: 12,
      },
    },
    {
      name: "completed evidence from another connector",
      toolItem: {
        type: "mcpToolCall",
        id: "wrong-connector-tool",
        server: "codex_apps",
        tool: "send_email",
        status: "completed",
        arguments: { to: "alice@example.com" },
        appContext: {
          connectorId: "connector_not_selected_for_this_turn",
          linkId: null,
          resourceUri: null,
          appName: "Gmail",
          templateId: null,
          actionName: "send_email",
        },
        pluginId: "gmail@openai-curated",
        result: { content: [], structuredContent: null, _meta: null },
        error: null,
        durationMs: 12,
      },
    },
    {
      name: "completed non-send action containing the word send",
      toolItem: {
        type: "mcpToolCall",
        id: "gmail-send-settings-tool",
        server: "codex_apps",
        tool: "get_send_settings",
        status: "completed",
        arguments: {},
        appContext: {
          connectorId: "connector_2128aebfecb84f64a069897515042a44",
          linkId: null,
          resourceUri: null,
          appName: "Gmail",
          templateId: null,
          actionName: "get_send_settings",
        },
        pluginId: "gmail@openai-curated",
        result: { content: [], structuredContent: null, _meta: null },
        error: null,
        durationMs: 12,
      },
    },
    {
      name: "completed status with an error payload",
      toolItem: {
        type: "mcpToolCall",
        id: "inconsistent-gmail-send-tool",
        server: "codex_apps",
        tool: "send_email",
        status: "completed",
        arguments: { to: "alice@example.com" },
        appContext: {
          connectorId: "connector_2128aebfecb84f64a069897515042a44",
          linkId: null,
          resourceUri: null,
          appName: "Gmail",
          templateId: null,
          actionName: "send_email",
        },
        pluginId: "gmail@openai-curated",
        result: null,
        error: { message: "inconsistent completion" },
        durationMs: 12,
      },
    },
  ])("fails closed on a claimed Gmail send with $name", async ({ toolItem }) => {
    const server = new FakeAppServer((message, fake) => {
      if (replyToHandshakeAndThread(message, fake, true)) return;
      if (message.method === "turn/start") {
        fake.send({
          id: message.id,
          result: { turn: { id: "gmail-send-turn", status: "inProgress" } },
        });
        if (toolItem) {
          fake.send({
            method: "item/completed",
            params: {
              threadId: "native-thread",
              turnId: "gmail-send-turn",
              item: toolItem,
            },
          });
        }
        fake.send({
          method: "item/completed",
          params: {
            threadId: "native-thread",
            turnId: "gmail-send-turn",
            item: {
              type: "agentMessage",
              id: "gmail-send-message",
              text: "已成功寄出郵件。",
              phase: "final_answer",
            },
          },
        });
        fake.send({
          method: "turn/completed",
          params: {
            threadId: "native-thread",
            turn: { id: "gmail-send-turn", status: "completed", items: [] },
          },
        });
      }
    });
    const runtime = new CodexAppServerRuntime({
      startProcess: () => server,
      timeoutMs: 250,
    });

    const reply = await runtime.respond(
      colleague,
      [],
      turn("請用 Gmail 寄信給 alice@example.com，主旨是測試。"),
    );
    expect(reply.text).toContain(UNVERIFIED_GMAIL_SEND_TEXT);
    await runtime.close();
  });

  it("does not preserve tool success without matching accepted approval metadata", async () => {
    const server = new FakeAppServer((message, fake) => {
      if (replyToHandshakeAndThread(message, fake, true)) return;
      if (message.method === "turn/start") {
        fake.send({
          id: message.id,
          result: { turn: { id: "verified-send-turn", status: "inProgress" } },
        });
        fake.send({
          method: "item/completed",
          params: {
            threadId: "native-thread",
            turnId: "verified-send-turn",
            item: {
              type: "mcpToolCall",
              id: "verified-gmail-send-tool",
              server: "codex_apps",
              tool: "send_email",
              status: "completed",
              arguments: { to: "alice@example.com" },
              appContext: {
                connectorId: "connector_2128aebfecb84f64a069897515042a44",
                linkId: null,
                resourceUri: null,
                appName: "Gmail",
                templateId: null,
                actionName: "send_email",
              },
              pluginId: "gmail@openai-curated",
              result: { content: [], structuredContent: null, _meta: null },
              error: null,
              durationMs: 10,
            },
          },
        });
        fake.send({
          method: "item/completed",
          params: {
            threadId: "native-thread",
            turnId: "verified-send-turn",
            item: {
              type: "agentMessage",
              id: "verified-send-message",
              text: "已成功寄出郵件。",
              phase: "final_answer",
            },
          },
        });
        fake.send({
          method: "turn/completed",
          params: {
            threadId: "native-thread",
            turn: { id: "verified-send-turn", status: "completed", items: [] },
          },
        });
      }
    });
    const runtime = new CodexAppServerRuntime({
      startProcess: () => server,
      timeoutMs: 250,
    });

    const reply = await runtime.respond(
      colleague,
      [],
      turn("請用 Gmail 寄信給 alice@example.com，主旨是測試。"),
    );
    expect(reply.text).toContain(UNVERIFIED_GMAIL_SEND_TEXT);
    await runtime.close();
  });

  it("returns the official connector OAuth page without starting a model turn", async () => {
    let appAccessible = false;
    const server = new FakeAppServer((message, fake) => {
      if (replyToHandshakeAndThread(message, fake, appAccessible)) return;
      if (message.method === "turn/start") {
        fake.send({
          id: message.id,
          result: { turn: { id: "reconnected-turn", status: "inProgress" } },
        });
        fake.send({
          method: "item/completed",
          params: {
            threadId: "native-thread",
            turnId: "reconnected-turn",
            item: {
              type: "agentMessage",
              id: "reconnected-message",
              text: "Gmail 已連接。",
              phase: "final_answer",
            },
          },
        });
        fake.send({
          method: "turn/completed",
          params: {
            threadId: "native-thread",
            turn: {
              id: "reconnected-turn",
              status: "completed",
              items: [],
            },
          },
        });
      }
    });
    const runtime = new CodexAppServerRuntime({
      startProcess: () => server,
      timeoutMs: 250,
    });

    await expect(
      runtime.respond(
        colleague,
        history,
        turn("幫我整理 Gmail 最近 14 天需要處理的信，未授權就給我 OAuth 連結"),
      ),
    ).resolves.toEqual({
      text:
        "Gmail plugin 已安裝，但目前這個 Codex 登入帳號還無法存取 Gmail connector。\n\n" +
        "[連接 Gmail](https://chatgpt.com/apps/gmail/connector_2128aebfecb84f64a069897515042a44)\n\n" +
        "請在官方頁面完成 OAuth，並選擇你要連接的 Gmail 帳號。完成後回來告訴我「重新檢查 Gmail」。",
    });
    expect(
      server.messages.filter((message) => message.method === "turn/start"),
    ).toHaveLength(0);

    appAccessible = true;
    await expect(
      runtime.respond(colleague, history, turn("重新檢查 Gmail")),
    ).resolves.toEqual({ text: "Gmail 已連接。" });
    const appLists = server.messages.filter(
      (message) => message.method === "app/list",
    );
    expect(
      appLists.slice(-2).map((message) => message.params?.forceRefetch),
    ).toEqual([true, true]);
    expect(
      server.messages.filter((message) => message.method === "turn/start"),
    ).toHaveLength(1);
    await runtime.close();
  });

  it("returns an official setup link without waiting for app/list", async () => {
    const server = new FakeAppServer((message, fake) => {
      if (replyToHandshakeAndThread(message, fake)) return;
    });
    const runtime = new CodexAppServerRuntime({
      startProcess: () => server,
      timeoutMs: 250,
    });

    await expect(
      runtime.respond(
        colleague,
        history,
        turn("我要用 cathayaids@gmail.com 登入 Gmail connector"),
      ),
    ).resolves.toEqual({
      text:
        "請使用 Gmail 的官方連接頁完成 OAuth，並在官方頁面選擇你要連接的 Gmail 帳號。\n\n" +
        "[連接 Gmail](https://chatgpt.com/apps/gmail/connector_2128aebfecb84f64a069897515042a44)\n\n" +
        "完成後回來告訴我「重新檢查 Gmail」。",
    });
    expect(
      server.messages.filter((message) => message.method === "app/list"),
    ).toHaveLength(0);
    expect(
      server.messages.filter((message) => message.method === "turn/start"),
    ).toHaveLength(0);
    await runtime.close();
  });

  it("uses app/list for OAuth guidance when plugin/read temporarily fails", async () => {
    const server = new FakeAppServer((message, fake) => {
      if (message.method === "plugin/read") {
        fake.send({
          id: message.id,
          error: { code: -32603, message: "temporary plugin read failure" },
        });
        return;
      }
      if (replyToHandshakeAndThread(message, fake)) return;
      if (message.method === "turn/start") {
        fake.send({
          id: message.id,
          result: { turn: { id: "unexpected-model-turn", status: "inProgress" } },
        });
        fake.send({
          method: "item/completed",
          params: {
            threadId: "native-thread",
            turnId: "unexpected-model-turn",
            item: {
              type: "agentMessage",
              id: "unexpected-message",
              text: "connector binding 無法解析",
              phase: "final_answer",
            },
          },
        });
        fake.send({
          method: "turn/completed",
          params: {
            threadId: "native-thread",
            turn: {
              id: "unexpected-model-turn",
              status: "completed",
              items: [],
            },
          },
        });
      }
    });
    const runtime = new CodexAppServerRuntime({
      startProcess: () => server,
      timeoutMs: 250,
    });

    await expect(
      runtime.respond(
        colleague,
        history,
        turn("幫我看看最近有哪些信需要處理"),
      ),
    ).resolves.toEqual({
      text:
        "Gmail plugin 已安裝，但目前這個 Codex 登入帳號還無法存取 Gmail connector。\n\n" +
        "[連接 Gmail](https://chatgpt.com/apps/gmail/connector_2128aebfecb84f64a069897515042a44)\n\n" +
        "請在官方頁面完成 OAuth，並選擇你要連接的 Gmail 帳號。完成後回來告訴我「重新檢查 Gmail」。",
    });
    expect(
      server.messages.filter((message) => message.method === "app/list"),
    ).toHaveLength(2);
    expect(
      server.messages.filter((message) => message.method === "turn/start"),
    ).toHaveLength(0);
    await runtime.close();
  });

  it("reads installed connectors from a remote curated marketplace", async () => {
    const server = new FakeAppServer((message, fake) => {
      if (message.method === "plugin/installed") {
        fake.send({
          id: message.id,
          result: {
            marketplaces: [
              {
                name: "openai-curated-remote",
                path: null,
                plugins: [
                  {
                    name: "gmail",
                    installed: true,
                    enabled: true,
                  },
                ],
              },
            ],
          },
        });
        return;
      }
      if (message.method === "plugin/read") {
        fake.send({
          id: message.id,
          result: {
            plugin: {
              apps: [{ id: "connector_gmail", name: "Gmail" }],
              skills: [
                {
                  name: "gmail:gmail",
                  path: "/tmp/plugins/gmail/skills/gmail/SKILL.md",
                  enabled: true,
                },
              ],
            },
          },
        });
        return;
      }
      if (message.method === "app/list") {
        fake.send({
          id: message.id,
          result: {
            data: [
              {
                id: "connector_gmail",
                name: "Gmail",
                isAccessible: true,
                isEnabled: true,
              },
            ],
            nextCursor: null,
          },
        });
        return;
      }
      if (replyToHandshakeAndThread(message, fake)) return;
      if (message.method === "turn/start") {
        fake.send({
          id: message.id,
          result: { turn: { id: "remote-plugin-turn", status: "inProgress" } },
        });
        fake.send({
          method: "item/completed",
          params: {
            threadId: "native-thread",
            turnId: "remote-plugin-turn",
            item: {
              type: "agentMessage",
              id: "remote-plugin-message",
              text: "Connected.",
              phase: "final_answer",
            },
          },
        });
        fake.send({
          method: "turn/completed",
          params: {
            threadId: "native-thread",
            turn: {
              id: "remote-plugin-turn",
              status: "completed",
              items: [],
            },
          },
        });
      }
    });
    const runtime = new CodexAppServerRuntime({
      startProcess: () => server,
      timeoutMs: 250,
    });

    await expect(
      runtime.respond(colleague, [], turn("用 Gmail 找最近的郵件")),
    ).resolves.toEqual({ text: "Connected." });
    expect(
      server.messages.find((message) => message.method === "plugin/read")
        ?.params,
    ).toEqual({
      remoteMarketplaceName: "openai-curated-remote",
      pluginName: "gmail",
    });

    await runtime.close();
  });

  it("streams visible answer deltas before the turn completes", async () => {
    let nativeTurnId = "";
    const server = new FakeAppServer((message, fake) => {
      if (replyToHandshakeAndThread(message, fake)) return;
      if (message.method === "turn/start") {
        nativeTurnId = "streaming-turn";
        fake.send({
          id: message.id,
          result: { turn: { id: nativeTurnId, status: "inProgress" } },
        });
        fake.send({
          method: "item/agentMessage/delta",
          params: {
            threadId: "native-thread",
            turnId: nativeTurnId,
            itemId: "streaming-message",
            delta: "收",
          },
        });
        fake.send({
          method: "item/agentMessage/delta",
          params: {
            threadId: "native-thread",
            turnId: nativeTurnId,
            itemId: "streaming-message",
            delta: "到",
          },
        });
      }
    });
    const runtime = new CodexAppServerRuntime({
      startProcess: () => server,
      timeoutMs: 500,
    });
    const deltas: string[] = [];

    const response = runtime.respond(colleague, [], turn("hello"), (delta) => {
      deltas.push(delta);
    });

    await vi.waitFor(() => expect(deltas).toEqual(["收", "到"]));
    server.send({
      method: "item/completed",
      params: {
        threadId: "native-thread",
        turnId: nativeTurnId,
        item: {
          type: "agentMessage",
          id: "streaming-message",
          text: "收到",
          phase: "final_answer",
        },
      },
    });
    server.send({
      method: "turn/completed",
      params: {
        threadId: "native-thread",
        turn: { id: nativeTurnId, status: "completed", items: [] },
      },
    });

    await expect(response).resolves.toEqual({ text: "收到" });
    await runtime.close();
  });

  it("loads Computer Use only for an explicit screen-control turn", async () => {
    const server = new FakeAppServer((message, fake) => {
      if (replyToHandshakeAndThread(message, fake)) return;
      if (message.method === "turn/start") {
        fake.send({
          id: message.id,
          result: { turn: { id: "computer-turn", status: "inProgress" } },
        });
        fake.send({
          method: "item/completed",
          params: {
            threadId: "native-thread",
            turnId: "computer-turn",
            item: {
              type: "agentMessage",
              id: "computer-message",
              text: "我看到畫面了。",
              phase: "final_answer",
            },
          },
        });
        fake.send({
          method: "turn/completed",
          params: {
            threadId: "native-thread",
            turn: { id: "computer-turn", status: "completed", items: [] },
          },
        });
      }
    });
    const runtime = new CodexAppServerRuntime({
      startProcess: () => server,
      timeoutMs: 250,
    });

    await expect(
      runtime.respond(colleague, [], turn("用 Computer Use 看看我目前的畫面")),
    ).resolves.toEqual({ text: "我看到畫面了。" });

    expect(
      server.messages.filter((message) => message.method === "skills/list"),
    ).toHaveLength(1);
    const started = server.messages.find(
      (message) => message.method === "turn/start",
    );
    expect(started?.params?.input).toEqual(
      expect.arrayContaining([
        {
          type: "skill",
          name: "computer-use:computer-use",
          path: "/tmp/codex/plugins/computer-use/skills/computer-use/SKILL.md",
        },
      ]),
    );
    expect(JSON.stringify(started?.params?.input)).not.toContain(
      "app://connector_2128aebfecb84f64a069897515042a44",
    );
    await runtime.close();
  });

  it("serializes turns belonging to the same external thread", async () => {
    const pendingTurnIds: string[] = [];
    const server = new FakeAppServer((message, fake) => {
      if (replyToHandshakeAndThread(message, fake)) return;
      if (message.method === "turn/start") {
        const nativeTurnId = `native-turn-${pendingTurnIds.length + 1}`;
        pendingTurnIds.push(nativeTurnId);
        fake.send({
          id: message.id,
          result: { turn: { id: nativeTurnId, status: "inProgress" } },
        });
      }
    });
    const runtime = new CodexAppServerRuntime({
      startProcess: () => server,
      timeoutMs: 500,
    });

    const first = runtime.respond(colleague, [], turn("first"));
    const second = runtime.respond(colleague, [], turn("second"));
    await vi.waitFor(() => expect(pendingTurnIds).toEqual(["native-turn-1"]));

    server.send({
      method: "item/completed",
      params: {
        threadId: "native-thread",
        turnId: "native-turn-1",
        completedAtMs: Date.now(),
        item: {
          type: "agentMessage",
          id: "message-1",
          text: "one",
          phase: "final_answer",
          memoryCitation: null,
        },
      },
    });
    server.send({
      method: "turn/completed",
      params: {
        threadId: "native-thread",
        turn: { id: "native-turn-1", status: "completed", items: [], error: null },
      },
    });

    await expect(first).resolves.toEqual({ text: "one" });
    await vi.waitFor(() =>
      expect(pendingTurnIds).toEqual(["native-turn-1", "native-turn-2"]),
    );
    server.send({
      method: "item/completed",
      params: {
        threadId: "native-thread",
        turnId: "native-turn-2",
        completedAtMs: Date.now(),
        item: {
          type: "agentMessage",
          id: "message-2",
          text: "two",
          phase: "final_answer",
          memoryCitation: null,
        },
      },
    });
    server.send({
      method: "turn/completed",
      params: {
        threadId: "native-thread",
        turn: { id: "native-turn-2", status: "completed", items: [], error: null },
      },
    });
    await expect(second).resolves.toEqual({ text: "two" });
    await runtime.close();
  });

  it("returns a stable safe timeout error and closes gracefully", async () => {
    const server = new FakeAppServer((message, fake) => {
      if (replyToHandshakeAndThread(message, fake)) return;
      if (message.method === "turn/start") {
        fake.send({
          id: message.id,
          result: { turn: { id: "stuck-turn", status: "inProgress" } },
        });
      }
    });
    const runtime = new CodexAppServerRuntime({
      startProcess: () => server,
      timeoutMs: 20,
    });

    const response = runtime.respond(colleague, [], turn("hello"));
    await expect(response).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "Codex took too long to reply.",
    });

    const closed = runtime.close();
    server.emit("close", 0, null);
    await closed;
    await expect(runtime.respond(colleague, [], turn("again"))).rejects.toMatchObject({
      code: "CLOSED",
      message: "Codex is not available because the runtime is closed.",
    });
  });
});
