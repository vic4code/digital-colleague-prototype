# ADR-007: Optional event-driven OpenClaw gateway for Codex

## Status

Accepted; supersedes the trigger boundary in ADR-006 when provider-event
latency is required. Codex Scheduled Tasks remain the dependency-light polling
option.

## Date

2026-07-15

## Context

The prototype now requires Gmail, Slack, Notion, Outlook, and calendar events
to wake the single digital colleague without a person first opening the web UI
or an interactive Codex thread.

Codex app-server exposes thread and turn execution, but it is not a provider
webhook receiver or scheduler. OpenAI Scheduled Tasks provide periodic work,
not provider push. OpenAI Workspace Agents now have an official Trigger API
with durable queueing, conversation keys, and idempotency, but it runs a
published ChatGPT Workspace Agent rather than this local Codex app-server and
currently does not return a public run id or retrievable response. It is not a
drop-in replacement for this repository's local Codex thread and API-observable
delivery loop.

OpenClaw `v2026.7.1` has an official OpenClaw Codex harness, Gmail Pub/Sub
setup, a Slack channel, generic authenticated hooks, sessions, audit, and
delivery. This is maintained by OpenClaw; it is not an OpenAI-supported
OpenClaw integration.

## Decision

Add an optional, pinned OpenClaw event-gateway deployment profile. Keep the
existing direct Codex app-server web/CLI path for interactive local use.

- Pin OpenClaw, `@openclaw/codex`, and `@openclaw/slack` to `2026.7.1`.
- Force the OpenAI provider to `agentRuntime.id: "codex"` so an unavailable
  harness fails closed instead of silently switching runtimes.
- Configure exactly one OpenClaw agent, `ada`. Native Codex sub-agents may
  still execute bounded work inside a turn; no persistent agent team or
  colleague registry is introduced.
- Admit only Gmail, Google Calendar, Outlook Email, Outlook Calendar, Slack,
  and Notion native Codex plugins. Disable account-wide plugin exposure and
  decline actions that native app metadata marks destructive during unattended
  runs. Keep the background prompt/skill no-write rule separately.
- Use the OpenClaw Gmail Pub/Sub setup and Slack channel rather than writing
  replacement transports in this repository.
- Provide authenticated fixed-route mappings with isolated sessions for
  normalized Notion, Outlook, and Google Calendar events. A mapping is only the
  receiving contract; it does not claim provider subscription setup is complete.
- Keep Microsoft Graph challenge/signature/renewal and Google Calendar push
  adapters out of the core until an official upstream integration or a
  separately reviewed relay is selected.
- Use `tools.exec.mode=ask` so the Codex app-server can start while unapproved
  host commands fail closed, disable hosted/managed web search, use a read-only
  Codex sandbox, and exclude the pinned OpenClaw dynamic exec, file, PDF,
  messaging, browser, web, session/spawn, node, and control-plane tools at the
  Codex harness layer.
  A generic OpenClaw `tools.allow/deny` restriction is intentionally not used:
  in `v2026.7.1` it also disables Codex native app-backed connector config.
- Remove control-plane secrets from the child environment, mount only Ada's
  workspace and the required safety resource, and expose only named provider
  routes through a path-allowlisting reverse proxy. Generic `/hooks/agent` and
  `/hooks/wake` remain local-only.
- Use separate gateway/hook tokens, limit hook agent/session selection, bound
  payload sizes, disable OTEL content capture, and prune sessions after seven
  days. Transcripts still persist inside protected state during retention.
- Keep Computer Use as an explicit local-only patch that disables hooks and the
  Slack channel. A headless server event worker does not receive desktop authority.

## Consequences

- Ada can be awakened by real external events without the frontend being open.
- Gmail and Slack can use upstream setup, validation, routing, and lifecycle
  behavior instead of repo-local transport code.
- OpenClaw becomes an optional privileged dependency only for event-driven
  deployments; a clone can still use Codex Scheduled Tasks without it.
- Provider OAuth and subscription provisioning remain operator actions and are
  never stored in git.
- Notion, Outlook, and Google Calendar are not all equally complete. Generic
  hook routes are ready, but strict provider-native delivery still depends on
  provider automation or a validated relay.
- Generic delivery is at-least-once. Duplicate event turns remain possible
  until a provider relay adds durable event-id deduplication.
- The stock OpenClaw Docker image does not include the Gmail watcher toolchain;
  Gmail remains host-native until a separately reviewed container path exists.
- A laptop deployment still stops receiving events while asleep or offline;
  24/7 behavior requires an always-on host.

## Sources

- https://developers.openai.com/workspace-agents/trigger-runs
- https://learn.chatgpt.com/docs/app-server
- https://learn.chatgpt.com/docs/automations
- https://github.com/openclaw/openclaw/blob/v2026.7.1/docs/plugins/codex-harness.md
- https://github.com/openclaw/openclaw/blob/v2026.7.1/docs/cli/webhooks.md
- https://github.com/openclaw/openclaw/blob/v2026.7.1/docs/channels/slack.md
- https://github.com/openclaw/openclaw/blob/v2026.7.1/docs/automation/webhook.md
