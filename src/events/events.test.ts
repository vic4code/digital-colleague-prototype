import { describe, expect, it, vi } from "vitest";
import {
  EventValidationError,
  ProactiveEventStore,
  parseProactiveEvent,
} from "./events.js";

const validEvent = {
  eventId: "gmail-evt-001",
  source: "gmail",
  type: "message.created",
  title: "  New message needs attention  ",
  summary: "  A bounded preview  ",
  occurredAt: "2026-07-15T13:00:00.000Z",
  ignored: "must not cross the boundary",
};

describe("parseProactiveEvent", () => {
  it("normalizes allowlisted fields and discards unknown provider data", () => {
    expect(parseProactiveEvent(validEvent)).toEqual({
      eventId: "gmail-evt-001",
      source: "gmail",
      type: "message.created",
      title: "New message needs attention",
      summary: "A bounded preview",
      occurredAt: "2026-07-15T13:00:00.000Z",
    });
  });

  it("accepts only the bounded task projection used by the notification UI", () => {
    expect(
      parseProactiveEvent({
        ...validEvent,
        eventId: "gmail-message-1:triaging:run-1",
        taskId: "gmail-message-1",
        phase: "triaging",
        replyPolicy: "approval_required",
        providerPayload: { body: "must never cross the ingress boundary" },
      }),
    ).toEqual({
      eventId: "gmail-message-1:triaging:run-1",
      source: "gmail",
      type: "message.created",
      title: "New message needs attention",
      summary: "A bounded preview",
      occurredAt: "2026-07-15T13:00:00.000Z",
      taskId: "gmail-message-1",
      phase: "triaging",
      replyPolicy: "approval_required",
    });
  });

  it.each([
    ["unknown source", { ...validEvent, source: "dropbox" }],
    ["blank event id", { ...validEvent, eventId: " " }],
    ["oversized title", { ...validEvent, title: "x".repeat(201) }],
    ["oversized summary", { ...validEvent, summary: "x".repeat(1_001) }],
    ["invalid timestamp", { ...validEvent, occurredAt: "yesterday" }],
    [
      "unknown task phase",
      { ...validEvent, taskId: "task-1", phase: "teleporting" },
    ],
    ["task phase without task id", { ...validEvent, phase: "triaging" }],
    [
      "reply policy without task id",
      { ...validEvent, replyPolicy: "approval_required" },
    ],
    [
      "unknown reply policy",
      { ...validEvent, taskId: "task-1", replyPolicy: "auto_send" },
    ],
  ])("rejects %s", (_label, input) => {
    expect(() => parseProactiveEvent(input)).toThrow(EventValidationError);
  });
});

describe("ProactiveEventStore", () => {
  it("deduplicates stable event ids without notifying twice", () => {
    const store = new ProactiveEventStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const first = store.accept(validEvent);
    const duplicate = store.accept({ ...validEvent, title: "Retry payload" });

    expect(first.duplicate).toBe(false);
    expect(duplicate).toEqual({ event: first.event, duplicate: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.list()).toEqual([first.event]);
  });

  it("keeps only the newest bounded events", () => {
    const store = new ProactiveEventStore(2);

    store.accept({ ...validEvent, eventId: "event-1" });
    store.accept({ ...validEvent, eventId: "event-2" });
    store.accept({ ...validEvent, eventId: "event-3" });

    expect(store.list().map((event) => event.eventId)).toEqual([
      "event-3",
      "event-2",
    ]);
    expect(store.accept({ ...validEvent, eventId: "event-1" }).duplicate).toBe(
      false,
    );
  });

  it("fails closed when bounded task authorization capacity is exhausted", () => {
    const store = new ProactiveEventStore(2);

    for (const taskId of ["message-1", "message-2"]) {
      store.accept({
        ...validEvent,
        eventId: `${taskId}:triaging`,
        taskId,
        phase: "triaging",
        replyPolicy: "approval_required",
      });
    }

    expect(() =>
      store.accept({
        ...validEvent,
        eventId: "message-3:triaging",
        taskId: "message-3",
        phase: "triaging",
        replyPolicy: "approval_required",
      }),
    ).toThrow(EventValidationError);
    expect(store.taskAuthorization("message-1")).toMatchObject({
      known: true,
      allowed: true,
      phase: "triaging",
    });
    expect(store.taskAuthorization("message-3")).toEqual({
      known: false,
      allowed: false,
      cancelled: false,
    });
    expect(store.taskAuthorization("message-2")).toMatchObject({
      known: true,
      allowed: true,
      phase: "triaging",
    });
    expect(store.list()).toHaveLength(2);
  });

  it.each(["cancelled", "completed", "failed"] as const)(
    "keeps a %s tombstone after its visible event is evicted",
    (terminalPhase) => {
      const store = new ProactiveEventStore(1);
      store.accept({
        ...validEvent,
        eventId: `message-1:${terminalPhase}`,
        taskId: "message-1",
        phase: terminalPhase,
        replyPolicy: "none",
      });
      store.accept({
        ...validEvent,
        eventId: "unrelated-notification",
      });

      expect(store.list().map((event) => event.eventId)).toEqual([
        "unrelated-notification",
      ]);
      expect(() =>
        store.accept({
          ...validEvent,
          eventId: "message-1:triaging:replay",
          taskId: "message-1",
          phase: "triaging",
          replyPolicy: "approval_required",
        }),
      ).toThrow(EventValidationError);
      expect(store.taskAuthorization("message-1")).toMatchObject({
        known: true,
        allowed: false,
        phase: terminalPhase,
      });
    },
  );

  it("removes subscribers cleanly", () => {
    const store = new ProactiveEventStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.accept(validEvent);

    expect(listener).not.toHaveBeenCalled();
  });

  it("cancels one active task without affecting another task", () => {
    const store = new ProactiveEventStore();
    store.accept({
      ...validEvent,
      eventId: "message-1:triaging:run-1",
      taskId: "message-1",
      phase: "triaging",
      replyPolicy: "approval_required",
    });
    store.accept({
      ...validEvent,
      eventId: "message-2:triaging:run-2",
      taskId: "message-2",
      phase: "triaging",
      replyPolicy: "approval_required",
    });

    const cancelled = store.cancelTask(
      "message-1",
      "2026-07-15T13:01:00.000Z",
    );

    expect(cancelled).toMatchObject({
      taskId: "message-1",
      phase: "cancelled",
      replyPolicy: "none",
    });
    expect(store.taskAuthorization("message-1")).toEqual({
      known: true,
      allowed: false,
      cancelled: true,
      phase: "cancelled",
    });
    expect(store.taskAuthorization("message-2")).toEqual({
      known: true,
      allowed: true,
      cancelled: false,
      phase: "triaging",
    });
  });

  it("fails closed for unknown, completed, and already-cancelled tasks", () => {
    const store = new ProactiveEventStore();
    expect(store.cancelTask("unknown-task")).toBeUndefined();
    expect(store.taskAuthorization("unknown-task")).toEqual({
      known: false,
      allowed: false,
      cancelled: false,
    });

    store.accept({
      ...validEvent,
      eventId: "message-1:completed:run-1",
      taskId: "message-1",
      phase: "completed",
      replyPolicy: "none",
    });
    expect(store.cancelTask("message-1")).toBeUndefined();
    expect(store.taskAuthorization("message-1")).toEqual({
      known: true,
      allowed: false,
      cancelled: false,
      phase: "completed",
    });
  });

  it("reports a cancellation request truthfully once sending may have begun", () => {
    const store = new ProactiveEventStore();
    store.accept({
      ...validEvent,
      eventId: "message-1:sending:run-1",
      taskId: "message-1",
      phase: "sending",
      replyPolicy: "none",
    });

    const cancelling = store.cancelTask(
      "message-1",
      "2026-07-15T13:01:00.000Z",
    );

    expect(cancelling).toMatchObject({
      taskId: "message-1",
      type: "task.cancelling",
      phase: "cancelling",
      summary: "已要求停止；如果 Gmail 已接受寄送，郵件仍可能送達。",
    });
    expect(store.taskAuthorization("message-1")).toEqual({
      known: true,
      allowed: false,
      cancelled: true,
      phase: "cancelling",
    });
    expect(store.cancelTask("message-1")).toBeUndefined();
  });

  it.each(["completed", "failed"] as const)(
    "rejects attempts to reopen a %s task",
    (terminalPhase) => {
      const store = new ProactiveEventStore();
      const listener = vi.fn();
      store.accept({
        ...validEvent,
        eventId: `message-1:${terminalPhase}`,
        taskId: "message-1",
        phase: terminalPhase,
        replyPolicy: "none",
      });
      store.subscribe(listener);

      expect(() =>
        store.accept({
          ...validEvent,
          eventId: `message-1:triaging:after-${terminalPhase}`,
          taskId: "message-1",
          phase: "triaging",
          replyPolicy: "approval_required",
        }),
      ).toThrow(EventValidationError);

      expect(listener).not.toHaveBeenCalled();
      expect(store.list()).toHaveLength(1);
      expect(store.taskAuthorization("message-1")).toEqual({
        known: true,
        allowed: false,
        cancelled: false,
        phase: terminalPhase,
      });
    },
  );

  it.each(["cancelling", "cancelled"] as const)(
    "rejects a new active event after a task is %s",
    (cancelPhase) => {
      const store = new ProactiveEventStore();
      store.accept({
        ...validEvent,
        eventId: "message-1:sending",
        taskId: "message-1",
        phase: "sending",
        replyPolicy: "none",
      });
      store.accept({
        ...validEvent,
        eventId: `message-1:${cancelPhase}`,
        taskId: "message-1",
        phase: cancelPhase,
        replyPolicy: "none",
      });

      expect(() =>
        store.accept({
          ...validEvent,
          eventId: `message-1:received:after-${cancelPhase}`,
          taskId: "message-1",
          phase: "received",
          replyPolicy: "approval_required",
        }),
      ).toThrow(EventValidationError);
      expect(store.taskAuthorization("message-1")).toEqual({
        known: true,
        allowed: false,
        cancelled: true,
        phase: cancelPhase,
      });
    },
  );

  it("allows a cancelling task to settle without reopening it", () => {
    const store = new ProactiveEventStore();
    store.accept({
      ...validEvent,
      eventId: "message-1:cancelling",
      taskId: "message-1",
      phase: "cancelling",
      replyPolicy: "none",
    });

    expect(() =>
      store.accept({
        ...validEvent,
        eventId: "message-1:cancelled",
        taskId: "message-1",
        phase: "cancelled",
        replyPolicy: "none",
      }),
    ).not.toThrow();
    expect(store.taskAuthorization("message-1")).toEqual({
      known: true,
      allowed: false,
      cancelled: true,
      phase: "cancelled",
    });
  });
});
