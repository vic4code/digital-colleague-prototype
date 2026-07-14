import type { Colleague, ChannelBinding, Turn, Reply } from "../colleague/types.js";
import { type Channel } from "./channel.js";
import { resolveAccount } from "../runtime/secrets.js";

/**
 * SlackChannel — the colleague's Slack presence. It authenticates as the
 * INFO account bound to this channel (info.yaml → accounts.slack), whose
 * secrets are resolved from the environment at runtime (never from git).
 *
 * Scope of this prototype:
 *   - Outbound `send()` is fully implemented against Slack's Web API
 *     (chat.postMessage) using the resolved bot token — no SDK dependency,
 *     just fetch.
 *   - Inbound receive requires Socket Mode / the Events API. `start()`
 *     verifies the credential with auth.test (proving Person/Info wiring) and
 *     documents the one remaining wire-up. This keeps the prototype honest:
 *     the identity + auth path is real; the websocket pump is the stub.
 */
export class SlackChannel implements Channel {
  readonly kind = "slack";
  private token = "";
  private running = false;

  async start(
    colleague: Colleague,
    binding: ChannelBinding,
    _onTurn: (turn: Turn) => Promise<Reply>,
  ): Promise<void> {
    const accountId = binding.account ?? "slack";
    const resolved = resolveAccount(colleague.info, accountId);
    if (resolved.missing.length) {
      throw new Error(
        `Slack account "${accountId}" is missing secrets: ` +
          `${resolved.missing.join(", ")}. Set them in your environment.`,
      );
    }
    this.token = resolved.secrets.botToken ?? "";
    if (!this.token) {
      throw new Error(
        `Slack account "${accountId}" resolved no "botToken" secret. ` +
          `Map it in info.yaml (secrets.botToken: SLACK_BOT_TOKEN).`,
      );
    }

    const identity = await this.authTest();
    console.log(
      `[slack] authenticated as ${identity.user} in ${identity.team} ` +
        `(bot for ${colleague.person.name}). Outbound is live.`,
    );
    console.log(
      `[slack] inbound events require Socket Mode (SLACK_APP_TOKEN) wired to ` +
        `onTurn(); that pump is the documented stub in this prototype.`,
    );
    this.running = true;

    // Keep the channel "open" so the standalone gateway stays alive. A full
    // build would open a Socket Mode websocket here and call onTurn() per event.
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

  /** Verify the bot token and return the bot identity. */
  private async authTest(): Promise<{ user: string; team: string }> {
    const res = await this.call("auth.test", {});
    return { user: res.user ?? "unknown", team: res.team ?? "unknown" };
  }

  /** Outbound: post a message as the colleague. */
  async send(channelId: string, text: string, threadTs?: string): Promise<void> {
    await this.call("chat.postMessage", {
      channel: channelId,
      text,
      thread_ts: threadTs,
    });
  }

  private async call(method: string, body: Record<string, unknown>): Promise<any> {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; error?: string; [k: string]: any };
    if (!json.ok) {
      throw new Error(`Slack ${method} failed: ${json.error ?? "unknown error"}`);
    }
    return json;
  }
}
