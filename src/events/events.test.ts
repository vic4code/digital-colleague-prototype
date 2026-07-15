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

  it.each([
    ["unknown source", { ...validEvent, source: "dropbox" }],
    ["blank event id", { ...validEvent, eventId: " " }],
    ["oversized title", { ...validEvent, title: "x".repeat(201) }],
    ["oversized summary", { ...validEvent, summary: "x".repeat(1_001) }],
    ["invalid timestamp", { ...validEvent, occurredAt: "yesterday" }],
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

  it("removes subscribers cleanly", () => {
    const store = new ProactiveEventStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.accept(validEvent);

    expect(listener).not.toHaveBeenCalled();
  });
});
