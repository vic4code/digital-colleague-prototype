export interface HealthData {
  status: "ok";
  runtime: string;
  colleague: { id: string; name: string };
}

export interface TurnData {
  threadId: string;
  reply: { text: string };
}

interface ApiEnvelope<T> {
  data: T;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  readonly name = "ApiError";

  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface ProactiveEvent {
  eventId: string;
  source: "gmail" | "outlook" | "calendar" | "slack" | "notion" | "system";
  type: string;
  title: string;
  summary?: string;
  occurredAt: string;
}

export interface RuntimeAccountStatus {
  available: boolean;
  requiresOpenaiAuth: boolean;
  account: null | {
    type: "apiKey" | "chatgpt" | "amazonBedrock";
    email?: string;
  };
}

export type RuntimeLoginStart =
  | { type: "chatgpt"; loginId: string; authUrl: string }
  | {
      type: "chatgptDeviceCode";
      loginId: string;
      verificationUrl: string;
      userCode: string;
    };

type TurnStreamEvent =
  | { type: "start"; threadId: string }
  | { type: "delta"; delta: string }
  | { type: "done"; threadId: string; reply: { text: string } }
  | { type: "error"; message: string };

async function readPayload<T>(response: Response): Promise<T> {
  let payload: ApiEnvelope<T> | ErrorEnvelope | undefined;
  try {
    payload = (await response.json()) as ApiEnvelope<T> | ErrorEnvelope;
  } catch {
    // A reverse proxy can return HTML or an empty response. Keep that detail
    // out of the UI and use the stable fallback below.
  }
  if (!response.ok || !payload || !("data" in payload)) {
    const message = payload && "error" in payload ? payload.error?.message : undefined;
    const code = payload && "error" in payload ? payload.error?.code : undefined;
    throw new ApiError(
      message || "Ada's local runtime is unavailable.",
      code,
      response.status,
    );
  }
  return payload.data;
}

export async function getProactiveEvents(): Promise<ProactiveEvent[]> {
  const response = await fetch("/api/v1/events", {
    headers: { accept: "application/json" },
  });
  return readPayload<ProactiveEvent[]>(response);
}

export function subscribeToProactiveEvents(handlers: {
  onReady(): void;
  onEvent(event: ProactiveEvent): void;
  onError(): void;
}): () => void {
  let source: EventSource | undefined;
  let retryTimer: number | undefined;
  let closed = false;

  const connect = () => {
    if (closed) return;
    source = new EventSource("/api/v1/events/stream");
    source.addEventListener("ready", () => {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      retryTimer = undefined;
      handlers.onReady();
    });
    source.addEventListener("notification", (message) => {
      try {
        handlers.onEvent(JSON.parse((message as MessageEvent<string>).data));
      } catch {
        handlers.onError();
      }
    });
    source.onerror = () => {
      handlers.onError();
      source?.close();
      source = undefined;
      if (!closed && retryTimer === undefined) {
        retryTimer = window.setTimeout(() => {
          retryTimer = undefined;
          connect();
        }, 3_000);
      }
    };
  };

  connect();
  return () => {
    closed = true;
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    source?.close();
  };
}

export async function getHealth(): Promise<HealthData> {
  const response = await fetch("/api/v1/health", {
    headers: { accept: "application/json" },
  });
  return readPayload<HealthData>(response);
}

export async function getRuntimeAccount(): Promise<RuntimeAccountStatus> {
  const response = await fetch("/api/v1/runtime/account", {
    headers: { accept: "application/json" },
  });
  return readPayload<RuntimeAccountStatus>(response);
}

export async function startRuntimeLogin(
  type: "chatgpt" | "chatgptDeviceCode",
): Promise<RuntimeLoginStart> {
  const response = await fetch("/api/v1/runtime/login", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ type }),
  });
  return readPayload<RuntimeLoginStart>(response);
}

export async function postTurn(
  text: string,
  threadId?: string,
  onDelta?: (delta: string) => void,
): Promise<TurnData> {
  const response = await fetch("/api/v1/turns", {
    method: "POST",
    headers: {
      accept: onDelta ? "text/event-stream" : "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(threadId ? { text, threadId } : { text }),
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  ) {
    return readPayload<TurnData>(response);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Ada's local runtime did not return a stream.");
  const decoder = new TextDecoder();
  let buffer = "";
  let result: TurnData | undefined;

  const processEvent = (block: string) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    const event = JSON.parse(data) as TurnStreamEvent;
    if (event.type === "delta") onDelta?.(event.delta);
    if (event.type === "done") {
      result = { threadId: event.threadId, reply: event.reply };
    }
    if (event.type === "error") throw new Error(event.message);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      processEvent(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) processEvent(buffer);
  if (!result) throw new Error("Ada's local runtime ended before replying.");
  return result;
}
