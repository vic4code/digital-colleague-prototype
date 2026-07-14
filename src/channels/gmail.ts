import type { Colleague, ChannelBinding, Turn, Reply } from "../colleague/types.js";
import { type Channel } from "./channel.js";
import { resolveAccount } from "../runtime/secrets.js";

/**
 * GmailChannel — the colleague's mailbox. It acts as the INFO account bound to
 * this channel (info.yaml → accounts.gmail), whose OAuth secrets are resolved
 * from the environment at runtime.
 *
 * Scope of this prototype:
 *   - `start()` resolves and validates the Gmail account's declared secrets,
 *     proving the Person/Info → mailbox binding is correct.
 *   - The actual IMAP/Gmail-API poll loop and RFC-822 send are documented as
 *     the remaining wire-up (they need googleapis / an OAuth flow, out of
 *     scope for a dependency-light prototype). The identity + credential path
 *     is real; the transport is the stub.
 */
export class GmailChannel implements Channel {
  readonly kind = "gmail";
  private running = false;
  private address = "";

  async start(
    colleague: Colleague,
    binding: ChannelBinding,
    _onTurn: (turn: Turn) => Promise<Reply>,
  ): Promise<void> {
    const accountId = binding.account ?? "gmail";
    const resolved = resolveAccount(colleague.info, accountId);
    this.address = resolved.address ?? "";

    if (resolved.missing.length) {
      throw new Error(
        `Gmail account "${accountId}" is missing secrets: ` +
          `${resolved.missing.join(", ")}. Set them in your environment ` +
          `(clientId / clientSecret / refreshToken).`,
      );
    }

    console.log(
      `[gmail] identity bound: ${colleague.person.name} ` +
        `<${this.address || "unknown address"}> — OAuth credentials resolved.`,
    );
    console.log(
      `[gmail] poll+send transport (Gmail API) is the documented stub; ` +
        `the account/secret binding above is live.`,
    );
    this.running = true;

    await new Promise<void>((resolve) => {
      const iv = setInterval(() => {
        if (!this.running) {
          clearInterval(iv);
          resolve();
        }
      }, 500);
    });
  }

  async stop(): Promise<void> {
    this.running = false;
  }
}
