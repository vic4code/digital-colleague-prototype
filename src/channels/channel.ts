import type { Colleague, Turn, Reply, ChannelBinding } from "../colleague/types.js";

/**
 * A Channel is an edge adapter: it "normalizes inputs … into canonical Turn
 * events" and delivers replies back out. Every channel implements the same
 * interface so the gateway is channel-agnostic — channel is metadata, not
 * identity.
 */
export interface Channel {
  readonly kind: string;
  /**
   * Start listening. For each inbound message, build a Turn and call
   * `onTurn`; send the returned Reply back on the channel.
   */
  start(
    colleague: Colleague,
    binding: ChannelBinding,
    onTurn: (turn: Turn) => Promise<Reply>,
  ): Promise<void>;
  stop(): Promise<void>;
}

/** Convenience for adapters to build a canonical Turn. */
export function makeTurn(
  channel: string,
  threadId: string,
  from: string,
  text: string,
  meta?: Record<string, unknown>,
): Turn {
  return { channel, threadId, from, text, meta, at: new Date().toISOString() };
}
