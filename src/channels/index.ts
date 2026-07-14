import type { Channel } from "./channel.js";
import { ConsoleChannel } from "./console.js";
import { SlackChannel } from "./slack.js";
import { GmailChannel } from "./gmail.js";

/** Registry of known channel adapters, keyed by ChannelBinding.kind. */
export function makeChannel(kind: string): Channel {
  switch (kind) {
    case "console":
      return new ConsoleChannel();
    case "slack":
      return new SlackChannel();
    case "gmail":
      return new GmailChannel();
    default:
      throw new Error(`Unknown channel kind "${kind}"`);
  }
}

export { ConsoleChannel, SlackChannel, GmailChannel };
export type { Channel };
