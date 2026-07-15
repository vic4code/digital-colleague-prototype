# Implementation plan: Cloneable digital colleague starter platform

This plan implements
[`spec-portable-codex-native-deployment.md`](./spec-portable-codex-native-deployment.md)
after its open questions are approved. Tasks follow dependency order and each
checkpoint leaves a runnable vertical slice.

## Phase 1: Public contracts and extension foundation

### Task 1: Make colleague skills Codex-native compatible

**Description:** Move new local skills to Codex-native
`.agents/skills/<name>/SKILL.md`, replace `summary` with the required
`description` metadata, run Codex from the trusted project context, and keep a
temporary loader fallback for legacy `colleagues/<id>/skills` directories.

**Acceptance:** Codex discovers the local AgentSkills folder; native skills
validate; legacy paths/summaries load with a deprecation warning; invalid
metadata fails with an actionable error.

**Verify:** unit tests, `npm run typecheck`, and `npm run build`.

**Dependencies:** none.
**Scope:** small, 3-4 files.

### Task 2: Define marketplace and template contracts

**Description:** Add versioned templates for the configured colleague, its
skills, and its plugins, plus a validator for manifests, marketplace paths, and
template output.

**Acceptance:** the configured colleague can be replaced from a template and a
domain plugin installs without editing core; plugin names do not collide;
external credentials are optional; a second active colleague is rejected.

**Verify:** fixture generation, plugin validation, and clean-clone install test.

**Dependencies:** Task 1.
**Scope:** medium, 4-5 files per template slice.

### Task 3: Add host-neutral config, state, and health contracts

**Description:** Define platform paths, redacted health, durable cursor and
idempotency storage interfaces, one structured error format, and Codex native
capability detection.

**Acceptance:** Windows, macOS, and container layouts are deterministic; health
cannot expose prompt or secret content; config fails before runtime start;
`multi_agent` support is reported and optional rather than reimplemented.

**Verify:** table-driven unit tests on all host modes.

**Dependencies:** Task 1.
**Scope:** medium, 4-5 files.

### Checkpoint 1

- Offline echo-runtime console flow still works.
- A fixture colleague/plugin can be configured and validated from a clean clone.

## Phase 2: Text web channel vertical slice

### Task 4: Implement the versioned web Turn API

**Description:** Add singular colleague identity, thread creation, idempotent
text Turn submission, and SSE lifecycle events over the standalone gateway.

**Acceptance:** text enters as `channel: web`; duplicate keys execute once;
SSE reconnect resumes from a bounded event cursor; all errors use one shape;
no endpoint accepts or returns a colleague selector.

**Verify:** API contract and gateway integration tests with the echo runtime.

**Dependencies:** Task 3.
**Scope:** medium, 4-5 files.

### Task 5: Build the accessible text frontend

**Description:** Create the React/TypeScript/Vite chat shell with colleague
header, transcript, composer, streamed reply, and connection/error states.

**Acceptance:** keyboard and screen-reader usable; responsive at 320, 768,
1024, and 1440px; retry never duplicates a Turn.

**Verify:** component tests, axe checks, and real-browser text flow.

**Dependencies:** Task 4.
**Scope:** medium slices of no more than 5 files each.

### Checkpoint 2

- A browser opens Ada directly, sends text, and receives a streamed echo reply.
- Network interruption and SSE reconnect do not duplicate memory entries.

## Phase 3: Push-to-talk voice vertical slice

### Task 6: Add the vendor-neutral SpeechProvider

**Description:** Define transcription and synthesis contracts plus a configured
OpenAI adapter and a disabled/offline implementation.

**Acceptance:** model/provider settings stay outside colleague identity; secrets
never reach the browser; text remains usable when speech is disabled.

**Verify:** adapter contract tests, timeout tests, and redaction tests.

**Dependencies:** Task 3.
**Scope:** medium, 4-5 files.

### Task 7: Add bounded audio API endpoints

**Description:** Add multipart transcription and text-to-speech endpoints with
authentication hooks, MIME sniffing, size/duration limits, and rate limits.

**Acceptance:** transcription never creates a Turn; raw audio is deleted after
processing; arbitrary provider options and SSML are rejected.

**Verify:** valid audio fixture, invalid MIME, oversized body, timeout, and
provider failure tests.

**Dependencies:** Tasks 4 and 6.
**Scope:** medium, 4-5 files.

### Task 8: Add microphone and playback UX

**Description:** Implement permission, recording, transcribing, transcript
review, send, playback, stop, and error states in the web client.

**Acceptance:** review-before-send is default; every audio reply has visible
text; keyboard operation and permission denial are fully supported.

**Verify:** browser tests with mocked media APIs plus a manual HTTPS/localhost
recording test in Chrome and Safari.

**Dependencies:** Tasks 5 and 7.
**Scope:** medium slices of no more than 5 files each.

### Checkpoint 3

- A user records one utterance, edits its transcript, sends it, receives the
  reply, and can play or stop captioned speech.

## Phase 4: Codex-native workspace Automations

### Task 9: Verify official workspace plugins and OAuth

**Description:** Install and verify the official Gmail, Google Calendar,
Outlook Email, Outlook Calendar, and Notion plugins. Record provider/account
selection in non-secret colleague config while OAuth stays in the connector
host.

**Acceptance:** Google and Microsoft are independently optional; a fresh Codex
session can run bounded read-only inbox and calendar probes; Notion sees only
explicitly connected content; no password or token enters the repo.

**Verify:** plugin inventory plus one redacted read-only smoke result per enabled
provider.

**Dependencies:** Task 3.
**Scope:** small, config and verification only.

### Task 10: Package provider-neutral inbox triage

**Description:** Add an `inbox-triage` skill plus a reusable schedule prompt and
setup flow that queries a bounded Gmail or Outlook window, classifies priority,
and prepares a summary or draft text inside the task result without creating a
provider-side draft, sending, or deleting anything. The actual schedule remains
user/workspace state, not plugin manifest content.

**Acceptance:** the task names its provider/account, cadence, query window,
maximum messages, escalation rule, and no-send/no-delete boundary; mail content
is treated as untrusted.

**Verify:** recorded connector fixtures, prompt-injection fixture, duplicate
thread fixture, and scheduled-task dry run.

**Dependencies:** Task 9.
**Scope:** medium, 4-5 files.

### Task 11: Package provider-neutral calendar brief

**Description:** Add a `calendar-brief` skill plus a reusable schedule prompt and
setup flow that reads a bounded Google or Outlook calendar window and surfaces
conflicts, preparation needs, and questions without changing events or
invitations.

**Acceptance:** the scheduled run performs reads only; create, update, cancel,
and invite actions require a separate interactive approval-capable run.

**Verify:** timezone, overlap, empty-window, private-event, and malicious-event
description fixtures.

**Dependencies:** Task 9.
**Scope:** medium, 4-5 files.

### Task 12: Add the optional provider-event profile

**Description:** Package a pinned OpenClaw `2026.7.1` profile that routes one
`ada` agent through the official OpenClaw Codex harness, uses the official
Gmail Pub/Sub and Slack channel surfaces, and provides authenticated normalized
hook contracts for Notion, Outlook, and Google Calendar.

**Acceptance:** Gmail and Slack setup use upstream commands/plugins; hook and
Gateway tokens differ; only Ada can be selected; provider content is untrusted;
native connector plugins are explicitly allowlisted with destructive actions
marked by app metadata declined; the event worker uses an app-server-compatible
fail-closed approval mode, excludes exec/file/PDF dynamic tools, and uses a
read-only sandbox; public ingress excludes generic agent/wake routes.
Documentation distinguishes a ready receiver mapping from completed provider
subscription setup and calls out at-least-once delivery.

**Verify:** static profile tests, upstream config dry-run on the pinned version,
unauthorized/authorized hook smoke tests, runtime proof that a turn used Codex,
and permission-denied fixtures.

**Dependencies:** Task 9.
**Scope:** small, 3-4 files.

### Checkpoint 4

- A scheduled inbox run surfaces bounded Gmail or Outlook work and may prepare
  draft text inside the task result, but cannot create a provider-side draft or
  send it.
- A scheduled calendar run produces a conflict/preparation brief without
  changing any event.
- The UI and docs distinguish connector access from event ingress. Scheduled
  Phase 0 remains available without OpenClaw; event-driven Phase 0.5 uses the
  optional pinned profile.

## Phase 5: Portable deployment

### Task 13: Build the hardened Docker deployment

**Description:** Add multi-stage image, entrypoint, health probe, Compose
services, non-root execution, and separate identity/memory mounts.

**Acceptance:** the web/runtime prototype runs in one colleague container; root
filesystem is read-only; replacement preserves state. Connector-only web
Scheduled Tasks remain Codex workspace state and are not duplicated in Docker.

**Verify:** Compose config, build, echo web smoke, and volume replacement test.

**Dependencies:** Tasks 4 and 8.
**Scope:** medium, 4-5 files.

### Task 14: Add macOS LaunchAgent lifecycle

**Description:** Implement idempotent install/status/uninstall scripts and a
LaunchAgent template serving the local runtime and web channel.

**Acceptance:** paths with spaces work; reinstall does not duplicate; uninstall
preserves identity, cursors, idempotency records, and memory by default.

**Verify:** shell/plist lint and manual macOS smoke test.

**Dependencies:** Task 13 health contract.
**Scope:** medium, 5 files.

### Task 15: Add Windows Scheduled Task lifecycle

**Description:** Implement equivalent per-user PowerShell lifecycle scripts.

**Acceptance:** runs at logon; secrets do not appear in arguments; preservation
semantics match macOS.

**Verify:** Pester tests and native Windows smoke test.

**Dependencies:** Task 13 health contract.
**Scope:** medium, 5 files.

### Checkpoint 5

- The same colleague and default web channel run through Docker, launchd, and
  Windows Scheduled Task.

## Phase 6: Default Codex plugins and MCP

### Task 16: Package core, builder, and web default plugins

**Description:** Add manifests, skills, templates, assets, marketplace policies,
and install verification for the three credential-free defaults.

**Acceptance:** a fresh Codex session discovers the operational, scaffolding,
and web setup skills; generated plugins validate and install.

**Verify:** plugin validator, clean marketplace install, and trigger tests.

**Dependencies:** Tasks 2, 5, and 8.
**Scope:** one medium slice per plugin.

### Task 17: Implement the local control MCP

**Description:** Build STDIO tools for colleague identity, health, idempotent
Turn submission, bounded audit events, and approval-gated restart.

**Acceptance:** schemas are versioned; tool safety annotations are accurate;
duplicates do not execute twice; sensitive fields are redacted.

**Verify:** MCP protocol contract suite from startup through memory persistence.

**Dependencies:** Tasks 3 and 4.
**Scope:** medium, 5 files.

### Task 18: Package optional workspace and Ada example plugins

**Description:** Add provider-neutral setup and automation skills for the
official Gmail, Outlook Email, Google Calendar, Outlook Calendar, Notion, and
Slack plugins, plus the Ada Legal domain skills.

**Acceptance:** connector auth failure does not hide default skills; Ada can be
removed without affecting core; schedule prompts remain resources rather than
an undocumented plugin manifest field; event-ingress setup points to the
separate ADR-007 deployment profile and does not imply every connector owns a
webhook.

**Verify:** fresh-session tests for each plugin alone and in combination.

**Dependencies:** Tasks 11, 16, and 17.
**Scope:** one medium slice per plugin.

### Checkpoint 6

- A clone provides three default plugins and two optional plugins.
- A developer creates and installs a new domain plugin without core edits.
- Codex-native ephemeral sub-agents can be used when available without adding
  a colleague/team registry or changing the public MCP contract.

## Phase 7: Remote access and release readiness

### Task 19: Add authenticated Streamable HTTP control MCP and web auth

**Description:** Expose remote control and web APIs with authentication,
authorization, request IDs, rate limits, restrictive CORS, and bounded timeouts.

**Acceptance:** local STDIO and remote HTTP share the MCP contract; unauthorized
requests fail closed; browser and MCP permissions are independently scoped.

**Verify:** auth, authorization, replay, CSRF/origin, timeout, and redaction
tests.

**Dependencies:** Tasks 17 and the decision on local/VPN versus public SSO.
**Scope:** medium slices, no more than 5 files each.

### Task 20: Add cross-platform release gates

**Description:** Add Windows/macOS/Linux CI, browser E2E, secret scanning,
plugin validation, provider-neutral mail/calendar fixture tests,
upgrade/rollback docs, and a compatibility matrix.

**Acceptance:** releases pin Node, Codex CLI, plugins, and image versions;
rollback preserves identity and all durable state; every spec criterion has
evidence.

**Verify:** clean-clone release and rollback rehearsals.

**Dependencies:** all previous checkpoints.
**Scope:** medium slices by CI/doc concern.

## Main risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| "Plugin" means both Codex package and runtime code | Extension contract becomes unsafe | Reserve plugin for Codex packages; keep runtime interfaces separately named and versioned. |
| Interactive Codex login does not fit unattended Docker | Runtime stops after token expiry | Require approved service authentication before production rollout. |
| Voice API becomes a second agent runtime | Split memory and approvals | Transcribe before Turn and synthesize after Reply; defer realtime voice. |
| Scheduled mail check is delayed or does not run | Colleague notices work late | Use a connector-only web task at a reviewed cadence, surface last-run status, and make clear that Phase 0 has no instant-delivery SLO. |
| Email or connector content injects instructions | Unauthorized action | Treat content as untrusted; deterministic allowlist, scopes, approval, and output policies run before/after the LLM. |
| Browser exposes provider credentials | Account compromise | All providers remain server-side; authenticated, rate-limited APIs only. |
