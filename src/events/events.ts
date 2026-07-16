import { createHash } from "node:crypto";

export const PROACTIVE_EVENT_SOURCES = [
  "gmail",
  "outlook",
  "teams",
  "calendar",
  "slack",
  "notion",
  "system",
] as const;

export type ProactiveEventSource = (typeof PROACTIVE_EVENT_SOURCES)[number];

export const PROACTIVE_TASK_PHASES = [
  "received",
  "triaging",
  "awaiting_approval",
  "sending",
  "cancelling",
  "cancelled",
  "completed",
  "failed",
] as const;

export type ProactiveTaskPhase = (typeof PROACTIVE_TASK_PHASES)[number];

const TERMINAL_TASK_PHASES: ReadonlySet<ProactiveTaskPhase> = new Set([
  "cancelled",
  "completed",
  "failed",
]);

function assertTaskDoesNotReopen(
  current: ProactiveEvent | undefined,
  next: ProactiveEvent,
): void {
  if (!current?.phase || !next.phase || current.phase === next.phase) return;

  if (current.phase === "cancelling") {
    if (TERMINAL_TASK_PHASES.has(next.phase)) return;
    throw new EventValidationError(
      `Task ${next.taskId} cannot return to ${next.phase} after cancellation started.`,
    );
  }

  if (TERMINAL_TASK_PHASES.has(current.phase)) {
    throw new EventValidationError(
      `Task ${next.taskId} cannot leave terminal phase ${current.phase}.`,
    );
  }
}

export const PROACTIVE_REPLY_POLICIES = ["none", "approval_required"] as const;

export type ProactiveReplyPolicy = (typeof PROACTIVE_REPLY_POLICIES)[number];

export interface ProactiveEvent {
  eventId: string;
  source: ProactiveEventSource;
  type: string;
  title: string;
  summary?: string;
  occurredAt: string;
  /** Stable provider-task key. Multiple phase events upsert one UI card. */
  taskId?: string;
  phase?: ProactiveTaskPhase;
  replyPolicy?: ProactiveReplyPolicy;
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

  const hasTaskProjection =
    input.taskId !== undefined ||
    input.phase !== undefined ||
    input.replyPolicy !== undefined;
  if (hasTaskProjection) {
    if (input.taskId === undefined || input.phase === undefined) {
      throw new EventValidationError(
        "taskId and phase are both required for a task projection.",
      );
    }
    if (
      typeof input.phase !== "string" ||
      !PROACTIVE_TASK_PHASES.includes(input.phase as ProactiveTaskPhase)
    ) {
      throw new EventValidationError("phase is not supported.");
    }
    event.taskId = boundedString(input.taskId, "taskId", 200);
    event.phase = input.phase as ProactiveTaskPhase;
    if (input.replyPolicy !== undefined) {
      if (
        typeof input.replyPolicy !== "string" ||
        !PROACTIVE_REPLY_POLICIES.includes(
          input.replyPolicy as ProactiveReplyPolicy,
        )
      ) {
        throw new EventValidationError("replyPolicy is not supported.");
      }
      event.replyPolicy = input.replyPolicy as ProactiveReplyPolicy;
    }
  }
  return event;
}

export class ProactiveEventStore {
  private readonly events: ProactiveEvent[] = [];
  private readonly eventIds = new Set<string>();
  private readonly latestTaskEvents = new Map<string, ProactiveEvent>();
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
    if (event.taskId) {
      const current = this.latestTaskEvents.get(event.taskId);
      if (!current && this.latestTaskEvents.size >= this.limit) {
        // Task authorization tombstones are security state, not display data.
        // Never evict them merely to admit another task: that would let a
        // cancelled/completed provider task replay as new. Capacity exhaustion
        // therefore fails closed until the process is deliberately recycled or
        // this prototype is backed by a durable task-state store.
        throw new EventValidationError(
          "Task authorization capacity is exhausted.",
        );
      }
      assertTaskDoesNotReopen(current, event);
    }

    this.events.unshift(event);
    this.eventIds.add(event.eventId);
    if (event.taskId) {
      this.latestTaskEvents.set(event.taskId, event);
    }
    if (this.events.length > this.limit) {
      const removed = this.events.pop();
      if (removed) {
        this.eventIds.delete(removed.eventId);
      }
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

  taskAuthorization(taskId: string): {
    known: boolean;
    allowed: boolean;
    cancelled: boolean;
    phase?: ProactiveTaskPhase;
  } {
    const current = this.latestTaskEvents.get(taskId);
    if (!current?.phase) {
      return { known: false, allowed: false, cancelled: false };
    }
    const cancelled =
      current.phase === "cancelling" || current.phase === "cancelled";
    const allowed =
      !cancelled &&
      ["received", "triaging", "awaiting_approval", "sending"].includes(
        current.phase,
      );
    return {
      known: true,
      allowed,
      cancelled,
      phase: current.phase,
    };
  }

  cancelTask(
    taskId: string,
    occurredAt = new Date().toISOString(),
  ): ProactiveEvent | undefined {
    const current = this.latestTaskEvents.get(taskId);
    if (
      !current?.phase ||
      ["completed", "failed", "cancelling", "cancelled"].includes(current.phase)
    ) {
      return undefined;
    }
    const sendMayHaveStarted = current.phase === "sending";
    const phase = sendMayHaveStarted ? "cancelling" : "cancelled";
    const digest = createHash("sha256").update(taskId).digest("hex").slice(0, 32);
    const { event } = this.accept({
      eventId: `task-cancel:${digest}`,
      source: current.source,
      type: `task.${phase}`,
      title: sendMayHaveStarted
        ? "Ada 正在停止這項工作"
        : "Ada 已停止這項工作",
      summary: sendMayHaveStarted
        ? "已要求停止；如果 Gmail 已接受寄送，郵件仍可能送達。"
        : "尚未開始的外部動作不會執行。",
      occurredAt,
      taskId,
      phase,
      replyPolicy: "none",
    });
    return event;
  }
}
