# ADR-005: Official trigger and automation substrate

## Status

Superseded by [ADR-006](./ADR-006-codex-native-automations-first.md)

## Date

2026-07-14

## Context

The digital colleague must react to Gmail, Slack, and Notion while no frontend
or interactive Codex thread is open. It must also follow up proactively on
deadlines, blocked work, and unanswered questions. Building a scheduler,
webhook gateway, retry queue, channel SDK, and task ledger in this repository
would duplicate mature official surfaces and create incompatible deployment
behavior across Windows, macOS, and Docker.

Codex Automations provide recurring scheduled work, but local automations work
best while the computer is awake and the Codex app is running, and completed
work is surfaced for review. That is not the same delivery contract as an
always-on mailbox or messaging channel.

OpenClaw provides a Gateway, official Slack channel, Gmail Pub/Sub setup,
webhook routes, cron, heartbeat, inferred commitments, standing orders, and a
background task ledger. It can use Codex as the reasoning harness.

## Decision

Use OpenClaw as the always-on trigger and automation substrate and Codex as the
reasoning runtime.

- Gmail uses `openclaw webhooks gmail setup`; do not build another Gmail watch
  renewal service or poll scheduler.
- Slack uses `@openclaw/slack` with stable channel-ID allowlists, mention gating,
  DMs, and thread routing.
- Notion official webhooks enter through OpenClaw Webhooks/TaskFlow; the Notion
  connection fetches and updates explicitly shared content.
- Exact schedules use OpenClaw Cron. Approximate awareness checks use
  Heartbeat. Conversation-derived follow-ups use inferred commitments.
- Standing Orders define proactive authority, recipients, cooldown, spending or
  side-effect limits, and approval gates.
- Codex Automations remain optional for user-owned recurring work in Codex. They
  are not required for channel delivery or server deployment.
- Provider events are normalized only at the identity/policy boundary. The repo
  does not create another generic event bus.

## Consequences

- The deployed service supervises OpenClaw Gateway, while the existing
  `dcolleague` CLI becomes validation, migration, and diagnostics.
- Most retry, scheduling, webhook, channel, and task-ledger code is upstream.
- Notion is not an unrestricted human account. It sees only content granted to
  its connection/PAT and only capabilities enabled by the workspace.
- Provider event IDs, thread IDs, and page IDs remain visible in audit metadata
  for deduplication and traceability.
- A future official Codex cloud trigger may replace an OpenClaw trigger only if
  it meets the same always-on, audit, retry, and delivery contract.

## Sources

- https://openai.com/academy/codex-automations/
- https://docs.openclaw.ai/automation
- https://docs.openclaw.ai/automation/cron-jobs
- https://docs.openclaw.ai/cli/webhooks
- https://docs.openclaw.ai/channels/slack
- https://docs.openclaw.ai/plugins/webhooks
- https://developers.notion.com/reference/webhooks-events-delivery
- https://developers.notion.com/reference/capabilities
