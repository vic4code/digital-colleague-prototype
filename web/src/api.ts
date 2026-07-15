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

export async function postTurn(text: string, threadId?: string): Promise<TurnData> {
  const response = await fetch("/api/v1/turns", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(threadId ? { text, threadId } : { text }),
  });
  return readPayload<TurnData>(response);
}
