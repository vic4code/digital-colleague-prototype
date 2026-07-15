import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { Colleague, Turn } from "../colleague/types.js";
import { makeRuntime } from "./agent.js";
import type { MemoryEntry } from "./memory.js";
import {
  CodexAppServerError,
  CodexAppServerRuntime,
  type AppServerProcess,
} from "./codex-app-server.js";

type ProtocolMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
};

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
    accounts: {},
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

function replyToHandshakeAndThread(
  message: ProtocolMessage,
  server: FakeAppServer,
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
            isAccessible: false,
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

  it("uses the native initialize, thread/start and turn/start protocol", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    let turnNumber = 0;
    const server = new FakeAppServer((message, fake) => {
      if (replyToHandshakeAndThread(message, fake)) return;
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
      "Gmail connector：plugin 已安裝，但目前這個 Codex 登入帳號無法存取",
    );
    expect(JSON.stringify(turns[0]?.params?.input)).toContain(
      "不得說 Gmail plugin 尚未安裝",
    );
    expect(JSON.stringify(turns[0]?.params?.input)).toContain(
      "@gmail $gmail $gmail-inbox-triage",
    );
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
