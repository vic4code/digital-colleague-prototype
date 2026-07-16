// @vitest-environment node
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reply, Turn } from "../colleague/types.js";
import { ProactiveEventStore } from "../events/events.js";
import { createTurnServer, type TurnServer } from "./server.js";
import type { TurnServerOptions } from "./server.js";

const servers: TurnServer[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function start(
  dispatch: (turn: Turn, onDelta?: (delta: string) => void) => Promise<Reply>,
  options: {
    timeoutMs?: number;
    maxConcurrent?: number;
    webRoot?: string;
    eventIngressToken?: string;
    eventStore?: ProactiveEventStore;
    account?: TurnServerOptions["account"];
  } = {},
) {
  const server = createTurnServer({
    dispatch,
    colleague: { id: "ada", name: "Ada" },
    runtime: "codex-app-server",
    ...options,
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

const eventPayload = {
  eventId: "gmail-event-1",
  source: "gmail",
  type: "message.created",
  title: "New message needs attention",
  summary: "A safe preview",
  occurredAt: "2026-07-15T13:00:00.000Z",
};

describe("localhost turn API", () => {
  it("serves the built web app and keeps API routes on the same origin", async () => {
    const webRoot = await mkdtemp(join(tmpdir(), "dcolleague-web-"));
    temporaryDirectories.push(webRoot);
    await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Ada</title>");
    await mkdir(join(webRoot, "assets"));
    await writeFile(join(webRoot, "assets", "app.js"), "console.log('ada')");
    const url = await start(async () => ({ text: "unused" }), { webRoot });

    const page = await fetch(`${url}/`);
    const asset = await fetch(`${url}/assets/app.js`);
    const spaRoute = await fetch(`${url}/conversation/today`);
    const health = await fetch(`${url}/api/v1/health`);

    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await page.text()).toContain("<title>Ada</title>");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("public");
    expect(spaRoute.status).toBe(200);
    expect(await spaRoute.text()).toContain("<title>Ada</title>");
    expect(health.status).toBe(200);
  });

  it("does not expose files outside the configured web root", async () => {
    const parent = await mkdtemp(join(tmpdir(), "dcolleague-web-"));
    temporaryDirectories.push(parent);
    const webRoot = join(parent, "public");
    await mkdir(webRoot);
    await writeFile(join(webRoot, "index.html"), "safe");
    await writeFile(join(parent, "secret.txt"), "do not serve");
    const url = await start(async () => ({ text: "unused" }), { webRoot });

    const traversal = await fetch(`${url}/..%2Fsecret.txt`);

    expect(traversal.status).toBe(404);
    expect(await traversal.text()).not.toContain("do not serve");
  });

  it("reports the configured colleague and native runtime", async () => {
    const url = await start(async () => ({ text: "unused" }));

    const response = await fetch(`${url}/api/v1/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: {
        status: "ok",
        runtime: "codex-app-server",
        colleague: { id: "ada", name: "Ada" },
      },
    });
  });

  it("reports Codex account readiness without returning tokens", async () => {
    const read = vi.fn(async () => ({
      available: true,
      requiresOpenaiAuth: true,
      account: { type: "chatgpt" as const, email: "ada@example.com" },
    }));
    const startLogin = vi.fn();
    const url = await start(async () => ({ text: "unused" }), {
      account: { read, startLogin },
    });

    const response = await fetch(`${url}/api/v1/runtime/account`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        available: true,
        requiresOpenaiAuth: true,
        account: { type: "chatgpt", email: "ada@example.com" },
      },
    });
  });

  it("starts only official browser or device-code login flows", async () => {
    const startLogin = vi.fn(async () => ({
      type: "chatgpt" as const,
      loginId: "login-1",
      authUrl: "https://auth.openai.com/authorize",
    }));
    const url = await start(async () => ({ text: "unused" }), {
      account: {
        read: async () => ({
          available: true,
          requiresOpenaiAuth: true,
          account: null,
        }),
        startLogin,
      },
    });

    const response = await fetch(`${url}/api/v1/runtime/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "chatgpt" }),
    });
    const rejectedSecret = await fetch(`${url}/api/v1/runtime/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "apiKey", apiKey: "must-not-cross-http" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { type: "chatgpt", authUrl: "https://auth.openai.com/authorize" },
    });
    expect(startLogin).toHaveBeenCalledWith("chatgpt");
    expect(rejectedSecret.status).toBe(422);
    expect(startLogin).toHaveBeenCalledTimes(1);

    startLogin.mockRejectedValueOnce(new Error("secret app-server diagnostic"));
    const failed = await fetch(`${url}/api/v1/runtime/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "chatgpt" }),
    });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({
      error: { code: "LOGIN_FAILED", message: "Codex login could not start." },
    });
  });

  it("normalizes a browser message into a Turn and returns Ada's reply", async () => {
    const dispatch = vi.fn(async (turn: Turn) => ({
      text: `Ada received: ${turn.text}`,
    }));
    const url = await start(dispatch);

    const response = await fetch(`${url}/api/v1/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Can you hear me?" }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: { threadId: string; reply: { text: string } };
    };
    expect(payload.data.threadId).toMatch(/^web:[0-9a-f-]{36}$/);
    expect(payload.data.reply.text).toBe("Ada received: Can you hear me?");
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "web",
        threadId: payload.data.threadId,
        from: "local-user",
        text: "Can you hear me?",
      }),
    );
  });

  it("streams answer deltas over SSE", async () => {
    const url = await start(async (_turn, onDelta) => {
      onDelta?.("收");
      onDelta?.("到");
      return { text: "收到" };
    });

    const response = await fetch(`${url}/api/v1/turns`, {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "hello" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const stream = await response.text();
    expect(stream).toContain('"type":"start"');
    expect(stream).toContain('"type":"delta","delta":"收"');
    expect(stream).toContain('"type":"delta","delta":"到"');
    expect(stream).toContain('"type":"done"');
  });

  it("continues a caller's existing thread", async () => {
    const dispatch = vi.fn(async () => ({ text: "continued" }));
    const url = await start(dispatch);
    const threadId = "web:0f289a92-7255-49f8-8332-e9f530d8f63c";

    const response = await fetch(`${url}/api/v1/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Continue", threadId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { threadId } });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ threadId }));
  });

  it.each([
    ["blank text", { text: "   " }],
    ["oversized text", { text: "x".repeat(4_001) }],
    ["invalid thread", { text: "hello", threadId: "../../secrets" }],
  ])("rejects %s before dispatch", async (_label, body) => {
    const dispatch = vi.fn(async () => ({ text: "should not run" }));
    const url = await start(dispatch);

    const response = await fetch(`${url}/api/v1/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_TURN",
        message: expect.any(String),
      },
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("requires JSON and rejects non-local browser origins", async () => {
    const url = await start(async () => ({ text: "unused" }));

    const wrongType = await fetch(`${url}/api/v1/turns`, {
      method: "POST",
      body: "hello",
    });
    const remoteOrigin = await fetch(`${url}/api/v1/turns`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
      },
      body: JSON.stringify({ text: "hello" }),
    });

    expect(wrongType.status).toBe(415);
    expect(remoteOrigin.status).toBe(403);
  });

  it("returns a generic error without leaking runtime details", async () => {
    const url = await start(async () => {
      throw new Error("secret token from stderr");
    });

    const response = await fetch(`${url}/api/v1/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });

    expect(response.status).toBe(502);
    const body = JSON.stringify(await response.json());
    expect(body).toContain("RUNTIME_UNAVAILABLE");
    expect(body).not.toContain("secret token");
  });

  it("bounds concurrent turns and runtime latency", async () => {
    let releaseFirst!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const url = await start(
      async () => {
        await blocked;
        return { text: "late" };
      },
      { timeoutMs: 20, maxConcurrent: 1 },
    );
    const request = () =>
      fetch(`${url}/api/v1/turns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      });

    const first = request();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const busy = await request();
    const timedOut = await first;
    releaseFirst();

    expect(busy.status).toBe(429);
    expect(timedOut.status).toBe(504);
  });

  it("authenticates, accepts, deduplicates, and replays proactive events", async () => {
    const eventStore = new ProactiveEventStore();
    const url = await start(async () => ({ text: "unused" }), {
      eventIngressToken: "test-ingress-token",
      eventStore,
    });
    const post = (token: string, payload = eventPayload) =>
      fetch(`${url}/api/v1/events`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

    const unauthorized = await post("wrong-token");
    const accepted = await post("test-ingress-token");
    const duplicate = await post("test-ingress-token");
    const replay = await fetch(`${url}/api/v1/events`);

    expect(unauthorized.status).toBe(401);
    expect(accepted.status).toBe(202);
    expect(accepted.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(accepted.json()).resolves.toMatchObject({
      data: { duplicate: false, event: eventPayload },
    });
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      data: { duplicate: true },
    });
    await expect(replay.json()).resolves.toEqual({ data: [eventPayload] });
  });

  it("fails closed when event ingress has no configured token", async () => {
    const url = await start(async () => ({ text: "unused" }), {
      eventStore: new ProactiveEventStore(),
      eventIngressToken: "",
    });

    const response = await fetch(`${url}/api/v1/events`, {
      method: "POST",
      headers: {
        authorization: "Bearer any-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(eventPayload),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EVENT_INGRESS_DISABLED" },
    });
  });

  it("validates proactive events before storing them", async () => {
    const url = await start(async () => ({ text: "unused" }), {
      eventIngressToken: "test-ingress-token",
      eventStore: new ProactiveEventStore(),
    });

    const response = await fetch(`${url}/api/v1/events`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-ingress-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...eventPayload, source: "unknown" }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_EVENT" },
    });
  });

  it("streams proactive events independently from Codex turns", async () => {
    const eventStore = new ProactiveEventStore();
    const dispatch = vi.fn(async () => ({ text: "must not run" }));
    const url = await start(dispatch, {
      eventIngressToken: "test-ingress-token",
      eventStore,
    });
    const controller = new AbortController();
    const streamResponse = await fetch(`${url}/api/v1/events/stream`, {
      signal: controller.signal,
    });
    const reader = streamResponse.body!.getReader();
    const decoder = new TextDecoder();
    const ready = decoder.decode((await reader.read()).value);

    const accepted = await fetch(`${url}/api/v1/events`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-ingress-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(eventPayload),
    });
    const notification = decoder.decode((await reader.read()).value);
    controller.abort();
    await reader.cancel().catch(() => undefined);

    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    expect(ready).toContain("retry: 3000");
    expect(ready).toContain("event: ready");
    expect(accepted.status).toBe(202);
    expect(notification).toContain("event: notification");
    expect(notification).toContain('"eventId":"gmail-event-1"');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("lets the local UI cancel one email task and exposes a token-protected send gate", async () => {
    const eventStore = new ProactiveEventStore();
    const url = await start(async () => ({ text: "unused" }), {
      eventIngressToken: "test-ingress-token",
      eventStore,
    });
    const taskEvent = {
      ...eventPayload,
      eventId: "gmail-message-1:triaging:run-1",
      taskId: "gmail-message-1",
      phase: "triaging",
      replyPolicy: "approval_required",
    };
    await fetch(`${url}/api/v1/events`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-ingress-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(taskEvent),
    });

    const cancelled = await fetch(
      `${url}/api/v1/tasks/${encodeURIComponent(taskEvent.taskId)}/cancel`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    const unauthorizedGate = await fetch(
      `${url}/api/v1/tasks/${encodeURIComponent(taskEvent.taskId)}/authorization`,
    );
    const gate = await fetch(
      `${url}/api/v1/tasks/${encodeURIComponent(taskEvent.taskId)}/authorization`,
      { headers: { authorization: "Bearer test-ingress-token" } },
    );

    expect(cancelled.status).toBe(202);
    await expect(cancelled.json()).resolves.toMatchObject({
      data: {
        taskId: taskEvent.taskId,
        phase: "cancelled",
        replyPolicy: "none",
      },
    });
    expect(unauthorizedGate.status).toBe(401);
    expect(gate.status).toBe(200);
    await expect(gate.json()).resolves.toEqual({
      data: {
        known: true,
        allowed: false,
        cancelled: true,
        phase: "cancelled",
      },
    });
  });

  it("rejects cancellation for unknown tasks and non-empty request bodies", async () => {
    const url = await start(async () => ({ text: "unused" }), {
      eventIngressToken: "test-ingress-token",
      eventStore: new ProactiveEventStore(),
    });
    const unknown = await fetch(`${url}/api/v1/tasks/unknown-task/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const invalid = await fetch(`${url}/api/v1/tasks/unknown-task/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: true }),
    });

    expect(unknown.status).toBe(404);
    expect(invalid.status).toBe(422);
  });
});
