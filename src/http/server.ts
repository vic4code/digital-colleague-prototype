import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { Reply, Turn } from "../colleague/types.js";
import { makeTurn } from "../channels/channel.js";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_TEXT_LENGTH = 4_000;
const THREAD_ID = /^web:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_ORIGIN = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/;

export type TurnServer = Server<typeof IncomingMessage, typeof ServerResponse>;

export interface TurnServerOptions {
  dispatch(turn: Turn, onDelta?: (delta: string) => void): Promise<Reply>;
  colleague: { id: string; name: string };
  runtime: string;
  timeoutMs?: number;
  maxConcurrent?: number;
  webRoot?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class RuntimeTimeoutError extends Error {}

function securityHeaders(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-security-policy", "default-src 'none'");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function staticSecurityHeaders(response: ServerResponse): void {
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
}

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  configuredRoot: string,
): Promise<boolean> {
  if ((request.method !== "GET" && request.method !== "HEAD") || !request.url) {
    return false;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    return false;
  }
  if (
    pathname.includes("\0") ||
    pathname.includes("\\") ||
    pathname.split("/").some((segment) => segment === "..")
  ) {
    return false;
  }

  const root = await realpath(configuredRoot).catch(() => undefined);
  if (!root) return false;
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let candidate = resolve(root, relativePath);
  const insideRoot = (file: string) => file === root || file.startsWith(`${root}${sep}`);
  if (!insideRoot(candidate)) return false;

  let fileInfo = await stat(candidate).catch(() => undefined);
  if (fileInfo?.isDirectory()) {
    candidate = resolve(candidate, "index.html");
    fileInfo = await stat(candidate).catch(() => undefined);
  }
  if (!fileInfo?.isFile() && !extname(relativePath)) {
    candidate = resolve(root, "index.html");
    fileInfo = await stat(candidate).catch(() => undefined);
  }
  if (!fileInfo?.isFile()) return false;

  const canonicalFile = await realpath(candidate).catch(() => undefined);
  if (!canonicalFile || !insideRoot(canonicalFile)) return false;
  const body = await readFile(canonicalFile);
  staticSecurityHeaders(response);
  response.statusCode = 200;
  response.setHeader(
    "content-type",
    CONTENT_TYPES[extname(canonicalFile).toLowerCase()] ?? "application/octet-stream",
  );
  response.setHeader(
    "cache-control",
    pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  );
  response.setHeader("content-length", body.byteLength);
  response.end(request.method === "HEAD" ? undefined : body);
  return true;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function sendError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(response, status, { error: { code, message } });
}

function startEventStream(response: ServerResponse): void {
  securityHeaders(response);
  response.statusCode = 200;
  response.setHeader("content-type", "text/event-stream; charset=utf-8");
  response.setHeader("connection", "keep-alive");
  response.setHeader("x-accel-buffering", "no");
  response.flushHeaders();
}

function sendEvent(response: ServerResponse, value: unknown): void {
  if (!response.destroyed && !response.writableEnded) {
    response.write(`data: ${JSON.stringify(value)}\n\n`);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    bytes += chunk.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function parseTurnBody(value: unknown): { text: string; threadId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(422, "INVALID_TURN", "Turn must be a JSON object.");
  }
  const body = value as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_TEXT_LENGTH) {
    throw new HttpError(
      422,
      "INVALID_TURN",
      `Text must contain between 1 and ${MAX_TEXT_LENGTH} characters.`,
    );
  }
  if (body.threadId !== undefined && typeof body.threadId !== "string") {
    throw new HttpError(422, "INVALID_TURN", "threadId must be a string.");
  }
  const threadId = (body.threadId as string | undefined) ?? `web:${randomUUID()}`;
  if (!THREAD_ID.test(threadId)) {
    throw new HttpError(422, "INVALID_TURN", "threadId is invalid.");
  }
  return { text, threadId };
}

function isAllowedOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  return origin === undefined || (typeof origin === "string" && LOCAL_ORIGIN.test(origin));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new RuntimeTimeoutError("Runtime timed out")),
      timeoutMs,
    );
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("Runtime failed"));
      },
    );
  });
}

export function createTurnServer(options: TurnServerOptions): TurnServer {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxConcurrent = options.maxConcurrent ?? 1;
  let inFlight = 0;

  return createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/api/v1/health") {
        sendJson(response, 200, {
          data: {
            status: "ok",
            runtime: options.runtime,
            colleague: options.colleague,
          },
        });
        return;
      }

      if (
        options.webRoot &&
        !request.url?.startsWith("/api/") &&
        (await serveStatic(request, response, options.webRoot))
      ) {
        return;
      }

      if (request.method !== "POST" || request.url !== "/api/v1/turns") {
        sendError(response, 404, "NOT_FOUND", "Route not found.");
        return;
      }
      if (!isAllowedOrigin(request)) {
        sendError(response, 403, "ORIGIN_FORBIDDEN", "Browser origin is not allowed.");
        return;
      }
      const contentType = request.headers["content-type"] ?? "";
      if (!contentType.toLowerCase().startsWith("application/json")) {
        sendError(response, 415, "JSON_REQUIRED", "Content-Type must be application/json.");
        return;
      }

      const body = parseTurnBody(await readJson(request));
      if (inFlight >= maxConcurrent) {
        sendError(response, 429, "RUNTIME_BUSY", "Ada is finishing another message. Try again shortly.");
        return;
      }

      const turn = makeTurn("web", body.threadId, "local-user", body.text);
      const stream = request.headers.accept
        ?.toLowerCase()
        .includes("text/event-stream");
      inFlight += 1;
      if (stream) {
        startEventStream(response);
        sendEvent(response, { type: "start", threadId: body.threadId });
      }
      const work = Promise.resolve().then(() =>
        stream
          ? options.dispatch(turn, (delta) =>
              sendEvent(response, { type: "delta", delta }),
            )
          : options.dispatch(turn),
      );
      const tracked = work.finally(() => {
        inFlight -= 1;
      });
      // The runtime may finish after an HTTP timeout. Keep observing its
      // rejection so it can never become an unhandled process error.
      void tracked.catch(() => {});
      const reply = await withTimeout(tracked, timeoutMs);
      if (stream) {
        sendEvent(response, {
          type: "done",
          threadId: body.threadId,
          reply: { text: reply.text },
        });
        response.end();
        return;
      }
      sendJson(response, 200, {
        data: {
          threadId: body.threadId,
          reply: { text: reply.text },
        },
      });
    } catch (error) {
      if (response.headersSent) {
        const message =
          error instanceof RuntimeTimeoutError
            ? "Ada took too long to answer. Please try again."
            : "Ada could not answer this message.";
        sendEvent(response, { type: "error", message });
        response.end();
        return;
      }
      if (error instanceof HttpError) {
        sendError(response, error.status, error.code, error.message);
        return;
      }
      if (error instanceof RuntimeTimeoutError) {
        sendError(response, 504, "RUNTIME_TIMEOUT", "Ada took too long to answer. Please try again.");
        return;
      }
      // Runtime and process details can contain prompts, paths, or tokens.
      // Keep them in the server process and expose only a stable public error.
      sendError(response, 502, "RUNTIME_UNAVAILABLE", "Ada could not answer this message.");
    }
  });
}
