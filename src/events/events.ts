export const PROACTIVE_EVENT_SOURCES = [
  "gmail",
  "outlook",
  "calendar",
  "slack",
  "notion",
  "system",
] as const;

export type ProactiveEventSource = (typeof PROACTIVE_EVENT_SOURCES)[number];

export interface ProactiveEvent {
  eventId: string;
  source: ProactiveEventSource;
  type: string;
  title: string;
  summary?: string;
  occurredAt: string;
}

export class EventValidationError extends Error {
  readonly name = "EventValidationError";
}

function boundedString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength) {
    throw new EventValidationError(
      `${field} must contain between 1 and ${maxLength} characters.`,
    );
  }
  return normalized;
}

export function parseProactiveEvent(value: unknown): ProactiveEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EventValidationError("Event must be a JSON object.");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.source !== "string" ||
    !PROACTIVE_EVENT_SOURCES.includes(input.source as ProactiveEventSource)
  ) {
    throw new EventValidationError("source is not supported.");
  }
  const occurredAt = boundedString(input.occurredAt, "occurredAt", 40);
  try {
    if (new Date(occurredAt).toISOString() !== occurredAt) throw new Error();
  } catch {
    throw new EventValidationError("occurredAt must be an ISO timestamp.");
  }

  const event: ProactiveEvent = {
    eventId: boundedString(input.eventId, "eventId", 200),
    source: input.source as ProactiveEventSource,
    type: boundedString(input.type, "type", 100),
    title: boundedString(input.title, "title", 200),
    occurredAt,
  };
  if (input.summary !== undefined) {
    event.summary = boundedString(input.summary, "summary", 1_000);
  }
  return event;
}

export class ProactiveEventStore {
  private readonly events: ProactiveEvent[] = [];
  private readonly eventIds = new Set<string>();
  private readonly subscribers = new Set<(event: ProactiveEvent) => void>();

  constructor(private readonly limit = 100) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Event store limit must be a positive integer.");
    }
  }

  accept(value: unknown): { event: ProactiveEvent; duplicate: boolean } {
    const event = parseProactiveEvent(value);
    if (this.eventIds.has(event.eventId)) {
      return {
        event: this.events.find((candidate) => candidate.eventId === event.eventId)!,
        duplicate: true,
      };
    }

    this.events.unshift(event);
    this.eventIds.add(event.eventId);
    if (this.events.length > this.limit) {
      const removed = this.events.pop();
      if (removed) this.eventIds.delete(removed.eventId);
    }
    for (const subscriber of this.subscribers) subscriber(event);
    return { event, duplicate: false };
  }

  list(): ProactiveEvent[] {
    return [...this.events];
  }

  subscribe(listener: (event: ProactiveEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }
}
