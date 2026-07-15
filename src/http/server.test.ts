// @vitest-environment node
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reply, Turn } from "../colleague/types.js";
import { createTurnServer, type TurnServer } from "./server.js";

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
  dispatch: (turn: Turn) => Promise<Reply>,
  options: { timeoutMs?: number; maxConcurrent?: number; webRoot?: string } = {},
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
});
