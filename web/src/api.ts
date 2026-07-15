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
    throw new Error(message || "Ada's local runtime is unavailable.");
  }
  return payload.data;
}

export async function getHealth(): Promise<HealthData> {
  const response = await fetch("/api/v1/health", {
    headers: { accept: "application/json" },
  });
  return readPayload<HealthData>(response);
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
