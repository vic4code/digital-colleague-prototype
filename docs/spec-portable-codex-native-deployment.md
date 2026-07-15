# Spec: Portable deployment and Codex-native distribution

**Status:** accepted baseline with the ADR-007 provider-event addendum
**Scope:** A cloneable Phase 0/0.5 starter platform for exactly one digital
colleague that deploys on Windows, macOS, and Docker, plus a repo marketplace
of Codex-native default plugins that adopters can copy and extend.

## Objective

Provide a deployable and extensible prototype that another team can clone,
start without external credentials, and evolve by customizing its one
colleague's skills, plugins, connectors, and channels. The same digital colleague definition
(`Person + Soul + Info + Memory + Skills`) must run in three host modes without
forking colleague data or business behavior:

1. **Windows native** for a named employee workstation or managed VDI.
2. **macOS native** for a named employee workstation.
3. **Docker** for an always-on, host-neutral deployment.

The executable prototype and Codex plugins are deliberately separate products:

- Codex owns reasoning, official app connectors, Scheduled Tasks, native
  skills/plugins, and ephemeral sub-agents.
- `dcolleague` is the existing executable prototype, identity validator, and
  migration/diagnostic CLI. It must not grow a parallel scheduler or webhook
  platform.
- The repo marketplace supplies generic default plugins for operating and
  extending the platform. Domain plugins such as Ada Legal demonstrate how a
  team adds its own workflows without modifying the core.
- OpenClaw is not required for scheduled-only Phase 0. Provider-event Phase 0.5
  uses the optional, pinned, separately reviewed profile under
  `deploy/openclaw/`.

Success means a developer can clone the repo, customize and deploy its one
colleague, install the default plugins, and create a domain plugin without
editing core source code.

## Singleton contract

- One repository clone owns one active colleague definition; Phase 0 keeps it
  at `colleagues/<id>` for compatibility with the current CLI.
- One native service, scheduled task, LaunchAgent, or container serves that one
  identity across every enabled channel.
- Web and MCP contracts do not accept a `colleagueId`, expose a colleague list,
  or route between colleagues. The configured colleague is implicit.
- Extensibility means adding skills, plugins, connectors, accounts, and
  channels to this colleague, or replacing its Person/Soul/Info definition.
- Persistent agent teams, peer-to-peer colleague messages, colleague discovery,
  colleague registries, and multi-tenant orchestration are out of scope.
- The configured colleague may use Codex-native ephemeral sub-agents inside a
  turn. They are execution workers, not colleagues: they have no Person, Soul,
  Info, mailbox, channel address, or durable independent memory.
- `person.team` and `person.reportsTo` describe the human organization and
  human escalation path; they do not establish agent-to-agent relationships.

## Architecture decision

```text
                         Codex / ChatGPT user
                                  |
                      repo plugin marketplace
                  /               |                 \
    core + builder + web    workspace connectors    examples
    skills/control MCP      Google/Microsoft/Notion  Ada Legal
                  \               |                 /
              Codex run / Scheduled Task / event turn
                      |          |          |
                  web/CLI      memory   colleague files

 Optional event ingress: provider -> OpenClaw Gateway -> Codex app-server

 Host adapter: Windows | macOS | Docker (web/runtime; no local Automation claim)
```

### Scheduled Tasks for Phase 0; event gateway for Phase 0.5

A Codex plugin is the installable package for skills and MCP-backed apps; it is
not a process supervisor. Codex Scheduled Tasks supply the smallest official
wake-up mechanism needed to validate periodic inbox and calendar awareness.
Connector-only web tasks can run without a local folder. Tasks that need local
project files require the computer to remain awake and the Codex desktop app to
be running. Both return output to a review surface. Phase 0 accepts those
boundaries. When immediate provider events are required, ADR-007 adds a pinned
OpenClaw ingress while keeping Codex app-server as the agent runtime.

This follows the Codex plugin model: plugins can package skills, connectors,
and MCP configuration, while apps are MCP-backed capabilities inside a plugin.

Sources:

- https://learn.chatgpt.com/docs/build-plugins
- https://learn.chatgpt.com/docs/build-app
- https://learn.chatgpt.com/docs/extend/mcp?surface=cli

## Codex-native proactive-work contract

Do not implement a custom event scheduler. Use Codex Scheduled Tasks with
official plugins/connectors and explicit review boundaries.

| Need | Official mechanism | Role in this clone |
|---|---|---|
| Gmail or Outlook inbox sweep | Codex Scheduled Task + official mail plugin | Periodically find bounded unread/recent mail and prepare a reviewable summary or draft. Never send from the scheduled run. |
| Google or Outlook calendar brief | Codex Scheduled Task + official calendar plugin | Read a bounded time window and surface conflicts, preparation needs, or questions. |
| Notion workspace review | Codex Scheduled Task or interactive run + official Notion plugin | Read only explicitly connected content; propose updates for review. |
| Exact recurring brief | Codex Scheduled Task using the supported interval/RRULE schedule | Return results to the Codex review queue. |
| Slack mention | OpenClaw Slack channel in Phase 0.5 | Signature-verified HTTP Events or Socket Mode wakes Ada in a channel-scoped session. |
| Notion automation | Authenticated OpenClaw mapped hook in Phase 0.5 | Capture the actual automation payload and map it to the normalized contract before enabling; general integration-webhook verification is not implied. |
| Consequential write | Interactive Codex run with approval | Send, delete, create/update events, and Notion writes do not run unattended. |

Codex Scheduled Tasks can use connected tools, plugins, and skills and can
return to the same thread. Connector-only checks use a web task; workflows that
need the clone use a local project task and therefore require its desktop host.
This is periodic best-effort awareness, not an immediate provider-event
delivery guarantee.

The schedule is user/workspace state created in the Codex UI or conversation.
Plugins package the skill and reusable prompt/resources; they do not invent a
`scheduledTasks` or `automations` manifest field.

Every task has a bounded query window, explicit provider/account, maximum item
count, and a no-send/no-delete/no-calendar-write/no-Notion-write rule. The
optional event profile has its own authentication, session, audit, provider
setup, and delivery contract; it does not change these unattended write limits.

## Provider-event contract

The optional profile under `deploy/openclaw/` pins OpenClaw and its Codex/Slack
plugins to `2026.7.1`, configures exactly one `ada` agent, forces fail-closed
Codex routing, and exposes only authenticated, bounded event paths.

- Gmail uses OpenClaw's official host-native Gmail Pub/Sub setup and watch
  renewal. The stock OpenClaw Docker image lacks the watcher toolchain and is
  not claimed as Gmail-ready.
- Slack uses OpenClaw's official channel with signature verification,
  stable-ID allowlists, and mention gating.
- Notion, Outlook Email/Calendar, and Google Calendar mappings accept normalized
  minimal payloads on fixed routes and create isolated sessions. A receiver
  mapping does not prove the provider subscription is configured.
- Microsoft Graph challenge/validation/renewal and Google Calendar push remain
  external adapter responsibilities until upstream support exists.
- Connector content is untrusted data. The event worker requires human
  approval for exec, excludes the dynamic exec/file/PDF surface, uses a
  read-only sandbox, and declines native app actions marked destructive; the
  background prompt/skill separately forbids all provider writes. Hook and
  Gateway tokens are distinct, generic hook routes stay behind an ingress
  allowlist, and transcripts remain protected state subject to retention.
- Generic/provider delivery is at-least-once; duplicate turns remain possible
  until a reviewed relay adds durable provider-event deduplication.

OpenAI Workspace Agents also expose an official Trigger API with conversation
keys and idempotency. It is not used here because it runs a published ChatGPT
Workspace Agent rather than the local Codex app-server and currently offers no
API-observable response retrieval for this repository's delivery loop.

Sources:

- https://developers.openai.com/workspace-agents/trigger-runs
- https://github.com/openclaw/openclaw/blob/v2026.7.1/docs/plugins/codex-harness.md
- https://github.com/openclaw/openclaw/blob/v2026.7.1/docs/cli/webhooks.md
- https://github.com/openclaw/openclaw/blob/v2026.7.1/docs/channels/slack.md

Additional sources:

- https://learn.chatgpt.com/docs/automations?surface=app
- https://developers.openai.com/codex/use-cases/manage-your-inbox
- https://learn.chatgpt.com/docs/agent-approvals-security

## Native extension contract

The project does not define a proprietary skill or plugin format.

| Extension | Canonical shape | Ownership |
|---|---|---|
| Local colleague skill | `.agents/skills/<name>/SKILL.md` with AgentSkills `name` and `description` | Codex-native discovery. |
| Reusable bundle | `.codex-plugin/plugin.json` plus `skills/`, optional `.mcp.json`, `.app.json`, `hooks/`, and `assets/` | Codex-native plugin and repo marketplace. |
| Interactive connector/tool | Plugin `.app.json` and/or `.mcp.json` | Codex/ChatGPT invokes it explicitly. |
| Periodic proactive work | Codex Scheduled Task using installed plugins and skills | Best effort while the Codex host is available; output is reviewable. |
| Provider event adapter | Pinned OpenClaw deployment profile | Optional Phase 0.5 runtime; never mislabeled as a Codex content bundle or OpenAI product. |

Repository-local skills move from the prototype's legacy
`colleagues/<id>/skills/` loader to `.agents/skills/`. During migration, the
loader may read the old path with a deprecation warning, but new scaffolds and
documentation emit only `.agents/skills/`. Codex must run with the clone as its
trusted project and the colleague workspace as its working context so native
skill discovery remains intact.

The compatibility direction is Codex-first. The repository maintains one
Codex-native distributable bundle rather than a second imitation plugin format.
Other runtimes may consume those skills or MCP tools only through documented
compatibility. OpenClaw remains optional for scheduled-only Phase 0.

Sources:

- https://learn.chatgpt.com/docs/build-skills
- https://learn.chatgpt.com/docs/build-plugins

## Codex-native sub-agent contract

The root Codex run is the one digital colleague. For a complex turn it may use
Codex's native multi-agent capability to spawn bounded sub-agents.

- Do not implement a custom `spawn_agent` MCP, agent database, roster, router,
  or scheduler.
- Sub-agents exist only for the parent task and receive the minimum task
  context and tools needed for their bounded work.
- They do not own channels, accounts, approvals, or durable colleague memory.
- The root colleague remains responsible for synthesis, policy enforcement,
  the final reply, and the single audit trail.
- Host preflight records whether the installed Codex supports native
  multi-agent execution. If unavailable or policy-disabled, the turn continues
  single-agent; deployment must not fail solely for that reason.
- Concurrency and child depth use Codex/runtime limits rather than a custom team
  configuration schema.

The currently installed development CLI is `codex-cli 0.144.4`, where
`codex features list` reports `multi_agent` as stable. Packaging must still
feature-detect rather than assume that local observation for every clone.

## Deployment contract

All three modes implement the same host contract.

| Contract | Required behavior |
|---|---|
| Artifact | Runs the versioned `dist/cli.js` built from this repository. |
| Identity | Mounts or points to exactly one `colleagues/<id>` directory. |
| Runtime | Invokes Codex CLI non-interactively; model selection is optional and defaults to the operator's Codex config. |
| Secrets | Reads secret values from the host secret environment; no values are written to colleague files, command arguments, or logs. |
| State | Persists `memory/` outside the application artifact and survives restart/upgrade. |
| Lifecycle | Supports install, start, stop, restart, status, logs, upgrade, and uninstall. |
| Preflight | Runs build/runtime checks plus `dcolleague doctor` before start. |
| Shutdown | Handles `SIGINT`/`SIGTERM` or the host equivalent and stops channels cleanly. |

The runtime command is logically identical everywhere:

```text
dcolleague run --colleague <COLLEAGUE_DIR> --deployment standalone
```

Host adapters provide paths, environment, supervision, and log routing only.
They do not alter prompts, skills, connector contracts, or channel policy.

## Mode A: Windows native

### Target

- Windows 11 or managed Windows VDI.
- Node.js 20+ and Codex CLI available to the same Windows user.
- PowerShell 7 recommended; Windows PowerShell 5.1 remains usable for the
  installer if scripts avoid PowerShell-7-only syntax.

Codex supports native Windows workflows in PowerShell; WSL is optional rather
than required. Source: https://learn.chatgpt.com/docs/windows/windows-sandbox

### Layout

```text
%LOCALAPPDATA%\DigitalColleague\app\<version>\
%APPDATA%\DigitalColleague\colleagues\ada\
%LOCALAPPDATA%\DigitalColleague\logs\ada\
%LOCALAPPDATA%\DigitalColleague\env\ada.env
```

### Supervision

Use a per-user Windows Scheduled Task as the Phase 0 default:

- trigger: user logon;
- action: `powershell.exe -File run-colleague.ps1 -Colleague ada`;
- restart on failure with bounded backoff;
- run as the colleague owner so the process can use that user's Codex login;
- secrets are loaded by the wrapper into the child environment, never placed
  in the task's command-line arguments.

For a machine-wide unattended service, use the Docker mode. A Windows service
wrapper can be added later, but it creates a second credential and update model
that the prototype does not need yet.

### Operator surface

```powershell
.\deploy\windows\install.ps1 -Colleague .\colleagues\ada
.\deploy\windows\status.ps1 -Id ada
.\deploy\windows\uninstall.ps1 -Id ada
```

## Mode B: macOS native

### Target

- Current supported macOS on Apple Silicon or Intel.
- Node.js 20+ and Codex CLI available to the same macOS user.

### Layout

```text
~/Library/Application Support/DigitalColleague/app/<version>/
~/Library/Application Support/DigitalColleague/colleagues/ada/
~/Library/Application Support/DigitalColleague/env/ada.env
~/Library/Logs/DigitalColleague/ada/
```

### Supervision

Use a per-user LaunchAgent at
`~/Library/LaunchAgents/com.digitalcolleague.ada.plist`:

- `RunAtLoad=true`;
- `KeepAlive` on unsuccessful exit;
- `WorkingDirectory` points to the versioned app directory;
- stdout/stderr point to the colleague log directory;
- a wrapper loads the protected env file, runs preflight, then `exec`s Node.

The service runs as the interactive user so it shares that user's Codex login
and repository permissions. Docker is preferred for a headless Mac server.

### Operator surface

```bash
./deploy/macos/install.sh --colleague ./colleagues/ada
./deploy/macos/status.sh --id ada
./deploy/macos/uninstall.sh --id ada
```

## Mode C: Docker

### Target

- Docker Engine or Docker Desktop on Windows, macOS, or Linux.
- One container per colleague in Phase 0.

### Image design

- Multi-stage build: compile TypeScript in a build stage; copy production
  dependencies and `dist/` into a slim Node 20 runtime image.
- Install a pinned Codex CLI version in the image.
- Run as a non-root user with a read-only root filesystem.
- Mount colleague identity read-only, but mount `memory/` as a separate
  read-write volume.
- Inject secrets with Compose `env_file`, Docker secrets, or the platform's
  secret manager. Never bake `.env`, Codex credentials, or colleague memory
  into the image.
- The healthcheck runs a non-secret runtime/identity probe. `doctor` remains a
  startup preflight because repeatedly testing OAuth credentials as a Docker
  healthcheck can create rate-limit and lockout risk.

### Volumes and environment

```text
/opt/dcolleague/colleague     read-only Person/Soul/Info/skills
/var/lib/dcolleague/memory    read-write persistent memory
/home/dcolleague/.codex       optional persistent Codex config/auth
```

Preferred unattended authentication is an injected API/provider credential.
Mounting a developer's entire host `~/.codex` directory is allowed only for
local testing and must not be the production default.

### Operator surface

```bash
docker compose build
docker compose run --rm ada doctor -c /opt/dcolleague/colleague
docker compose up -d ada
docker compose logs -f ada
```

## Reference frontend channel: text and voice

The clone includes a `web` channel as the default human interaction surface.
It is a real channel adapter, not a second agent runtime: all text derived from
typing or speech becomes the same canonical `Turn`, passes through the same
in-process dispatch path, and is persisted by the same memory contract.

### Phase 0 user flow

1. Open the responsive web client for the deployed colleague.
2. Type a message, or hold/tap the microphone button to record one utterance.
3. The browser records through `MediaRecorder` and uploads the audio over
   HTTPS. The server transcribes it through a configurable `SpeechProvider`.
4. The transcript appears in the composer for review and editing. It is not
   auto-sent by default.
5. Sending creates a `channel: "web"` canonical Turn with an idempotency key.
6. The reply streams to the browser as server-sent events. After completion,
   the user may play an audio rendering produced by the configured speech
   provider.

Push-to-talk is the Phase 0 voice mode. Full-duplex realtime voice is deferred
because it would introduce a second conversational runtime and make it unclear
whether Codex or the realtime voice model owns memory, tools, and approvals.

Browser recording uses the standard `MediaRecorder` API and reply progress uses
server-sent events:

- https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
- https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events

The default cloud speech adapter may use OpenAI speech-to-text and text-to-
speech APIs, but `SpeechProvider` remains vendor-neutral and model names are
configuration rather than colleague identity:

- https://developers.openai.com/api/docs/guides/speech-to-text
- https://developers.openai.com/api/docs/guides/text-to-speech

### Web API contract

| Endpoint | Behavior |
|---|---|
| `GET /api/v1/colleague` | Return the configured colleague's public identity and health only. |
| `POST /api/v1/threads` | Create a web conversation and return its stable thread ID. |
| `POST /api/v1/threads/:threadId/turns` | Validate and submit one text Turn with an idempotency key. |
| `GET /api/v1/threads/:threadId/events` | Stream accepted, running, reply-delta, completed, and failed events over SSE. |
| `POST /api/v1/audio/transcriptions` | Accept bounded multipart audio and return a transcript; never creates a Turn. |
| `POST /api/v1/audio/speech` | Convert an approved reply text to audio; no arbitrary SSML or provider credentials from clients. |

Audio uploads default to a 10 MB and 120 second ceiling (below the current
OpenAI transcription limit), with MIME sniffing, timeouts, and rate limits.
Raw audio is deleted after transcription by default; memory
stores the reviewed transcript, not the recording. Remote deployments require
authentication and restrictive CORS. Microphone denial, missing speech
credentials, transcription failure, and playback failure must leave text chat
fully usable.

### Frontend quality contract

- React + TypeScript + Vite, with presentation separated from API state.
- Mobile-first layouts verified at 320, 768, 1024, and 1440 pixels.
- Keyboard-operable composer and microphone control, visible focus, semantic
  labels, live regions for recording/transcribing/responding, and text captions
  for every audio response.
- Explicit idle, connecting, recording, transcribing, responding, offline, and
  error states; no color-only status indicators.
- Clearly disclose that synthesized voices are AI-generated, as required by
  the default OpenAI speech adapter's usage policy.
- The browser receives no model, Gmail, Slack, or speech-provider credentials.

## Mail and calendar Scheduled Task contract

Phase 0 supports Gmail or Outlook Email and Google Calendar or Outlook Calendar
through their official Codex plugins. OAuth belongs to the connector host;
passwords, access tokens, and refresh tokens never enter `info.yaml`, `.env`,
the browser client, or repository history.

A recurring task may:

- search a bounded unread/recent mail window;
- summarize priority, sender, subject, age, and proposed next action;
- prepare reviewable draft text inside the task result without creating a
  provider-side draft;
- read a bounded calendar window and flag conflicts or preparation needs; and
- surface results in the Codex review queue.

A recurring task must not send, archive, trash, delete, label, or move mail;
create, update, cancel, or invite to calendar events; or make Notion changes.
Those actions require a separate interactive run with the connector's approval
policy. Mail, event descriptions, attachments, and linked documents are
untrusted input and never become authority to call another tool.

Every task declares:

- the provider and connected account;
- the search/time window and maximum item count;
- the cadence and local timezone;
- the allowed read/draft outputs;
- a no-external-send/no-destructive-write rule; and
- what should be escalated to the human owner.

The scheduled-only Phase 0 service level is explicitly best effort. Web connector tasks do not
require the local clone to be online, while local project tasks may not run when
the machine sleeps or Codex is closed. Neither mode claims instant handling of
a newly arrived message. Phase 0.5 provider events use the separately reviewed
ADR-007 profile. A sleeping local host is still not an always-on service.

Sources:

- https://learn.chatgpt.com/docs/automations?surface=app
- https://developers.openai.com/codex/use-cases/manage-your-inbox
- https://help.openai.com/en/articles/10408842-google-connector-for-chatgpt-data-controls-faq
- https://help.openai.com/en/articles/12512241-outlook-email-and-calendar-connectors-for-chatgpt/

## Codex-native plugin marketplace

### Package boundary

The repository itself is a Codex plugin marketplace. A clone exposes a small
set of generic default plugins plus one example domain plugin. Plugins are
independently installable so the credential-free core never depends on Gmail,
Slack, or a particular colleague identity.

| Plugin | Marketplace policy | Purpose |
|---|---|---|
| `digital-colleague-core` | installed by default | Inspect, validate, run, diagnose, and submit work to the clone's configured colleague through the control MCP. |
| `digital-colleague-builder` | installed by default | Configure the clone's colleague and scaffold its skills or plugins from repository templates. It edits only the user's clone. |
| `digital-colleague-web` | installed by default | Configure and diagnose the text/voice web channel; includes the reference frontend deployment skill. |
| `digital-colleague-workspace` | available, auth on install | Provider-neutral mail, calendar, Notion, and Slack setup plus Scheduled Task skills; official service plugins remain independently installed. |
| `ada-legal-ops` | available example | Demonstrates a domain plugin with contract review and legal intake skills; not part of core behavior. |

`digital-colleague-core`, `digital-colleague-builder`, and
`digital-colleague-web` form the default developer experience. The workspace
connector plugin is opt-in because it requires external accounts. Ada Legal is
an executable reference and test fixture, not the product identity.

Proposed layout:

```text
.agents/plugins/marketplace.json
plugins/
├── digital-colleague-core/
│   ├── .codex-plugin/plugin.json
│   ├── .mcp.json                 # local/remote dcolleague-control MCP
│   └── skills/colleague-operations/SKILL.md
├── digital-colleague-builder/
│   ├── .codex-plugin/plugin.json
│   ├── skills/configure-colleague/SKILL.md
│   ├── skills/create-domain-plugin/SKILL.md
│   └── templates/
├── digital-colleague-web/
│   ├── .codex-plugin/plugin.json
│   └── skills/web-channel-setup/SKILL.md
├── digital-colleague-workspace/
│   ├── .codex-plugin/plugin.json
│   ├── skills/inbox-triage/SKILL.md
│   ├── skills/calendar-brief/SKILL.md
│   └── skills/workspace-setup/SKILL.md
└── ada-legal-ops/
    ├── .codex-plugin/plugin.json
    └── skills/
        ├── contract-review/SKILL.md
        └── legal-intake-triage/SKILL.md
```

Codex requires `.codex-plugin/plugin.json` for a plugin and requires every
`SKILL.md` to contain `name` and `description`. Repository skills are normally
discovered from `.agents/skills`; reusable skills distributed with connectors
belong in a plugin. Sources:

- https://learn.chatgpt.com/docs/build-plugins
- https://learn.chatgpt.com/docs/build-skills

### Plugin manifest contract

The manifest owns presentation and relative component paths only:

```json
{
  "name": "digital-colleague-core",
  "version": "0.1.0",
  "description": "Operate and diagnose this clone's deployed digital colleague.",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json"
}
```

The `mcpServers` property is confirmed by the installed Codex 0.144.4 official
plugin examples; `.mcp.json` then contains a top-level `mcpServers` object. The
implementation must still run the installed plugin validator so future Codex
schema changes fail during packaging rather than at user install time.

### Default native skills

| Skill | Trigger and responsibility | Tool dependency |
|---|---|---|
| `colleague-operations` | Inspect a colleague's status, run preflight, diagnose a deployment, view bounded audit events, and request a restart. | `dcolleague-control` MCP. |
| `configure-colleague` | Customize the clone's single Person/Soul/Info definition, validate it, and run an echo smoke test. | Local files and shell. |
| `create-domain-plugin` | Scaffold a Codex-native domain plugin for the configured colleague with valid manifest, skill metadata, marketplace entry, and tests. | Local files and shell. |
| `web-channel-setup` | Start, configure, and diagnose the reference text/voice frontend without exposing provider credentials. | Local files and shell. |
| `workspace-setup` | Configure and diagnose optional Google, Microsoft, Notion, and Slack connectors without making them core dependencies. | Official Codex app connectors. |
| `inbox-triage` | Periodically review bounded Gmail or Outlook results and prepare summaries/drafts without sending. | Gmail or Outlook Email plugin. |
| `calendar-brief` | Review a bounded Google or Outlook calendar window and surface preparation needs without changing events. | Google or Outlook Calendar plugin. |

Example-only skills remain in `ada-legal-ops`: `contract-review` and
`legal-intake-triage`.

Each skill uses Codex-native front matter:

```yaml
---
name: contract-review
description: Review an NDA, MSA, DPA, or order form against Ada's Legal playbook; draft cited risks and redlines, but never approve or send the agreement.
---
```

The existing colleague-local `contract-review` content remains the business
source. During implementation it will be made native-compatible by replacing
`summary` with `description`, and the loader will accept `description` while
temporarily retaining `summary` as a migration fallback.

### Connectors and MCP tools

There are three integration classes, with distinct ownership:

1. **Official workspace app connectors** — Gmail or Outlook Email, Google or
   Outlook Calendar, Notion, and optional Slack. Authentication happens through
   each installed connector. Scheduled Tasks may use bounded reads and prepare
   draft text inside their task result, but never create a provider-side draft;
   consequential writes remain interactive.
2. **Repo skills** — provider-neutral inbox triage, calendar brief, and workspace
   setup workflows. They orchestrate official plugins but never copy or export
   connector credentials.
3. **`dcolleague-control` MCP** — the product-owned bridge to the local web and
   runtime prototype. It is not a provider event gateway.
4. **Optional OpenClaw event profile** — provider ingress, channel sessions,
   wake-up, delivery, and metadata audit. It sends agent turns to Codex
   app-server and does not own connector OAuth inside this plugin.

The control MCP exposes a minimal contract:

| Tool | Safety | Purpose |
|---|---|---|
| `get_colleague` | read-only | Return public Person data and deployment state; never Soul secrets or credential values. |
| `get_health` | read-only | Return version, host mode, runtime reachability, channel status, and last successful turn timestamp. |
| `submit_turn` | write, idempotent | Submit one canonical Turn with a caller-supplied idempotency key. |
| `list_audit_events` | read-only | Return bounded, redacted events using cursor pagination. |
| `request_restart` | write, confirmation required | Ask the host supervisor to restart the configured colleague instance. |

All tool inputs and outputs are versioned schemas. Errors use one stable shape:

```json
{
  "error": {
    "code": "COLLEAGUE_UNAVAILABLE",
    "message": "The configured colleague is not accepting turns.",
    "retryable": true,
    "requestId": "req_..."
  }
}
```

Local deployments use an STDIO MCP server. Docker or remote deployments use
Streamable HTTP with OAuth or a bearer token sourced from an environment
variable. Codex supports both transports and project-scoped MCP config.
Source: https://learn.chatgpt.com/docs/extend/mcp?surface=cli

## Commands

Current commands remain valid:

```bash
npm ci
npm run build
npm run typecheck
node dist/cli.js inspect -c colleagues/ada
DC_AGENT_RUNTIME=echo node dist/cli.js run -c colleagues/ada --channel console
```

Planned verification commands:

```bash
npm test
npm run verify:plugin
npm run verify:deploy
npm run web:dev
npm run web:build
npm run test:e2e
docker compose config --quiet
docker build -t digital-colleague:test .
```

## Project structure

```text
deploy/windows/                 PowerShell lifecycle adapters
deploy/macos/                   launchd templates and shell lifecycle adapters
deploy/docker/                  image entrypoint and healthcheck
plugins/                       default, optional, and example Codex packages
  digital-colleague-workspace/ provider-neutral inbox/calendar skills + prompts
.agents/plugins/               repo marketplace catalog
templates/                     copy-safe colleague, skill, and plugin starters
web/                           responsive text/voice frontend
src/api/                       versioned web, SSE, and audio boundary
src/runtime/speech/            vendor-neutral speech adapters
src/control-mcp/               local/remote MCP server
src/host/                      host-neutral paths, config, health contracts
tests/                         unit and integration tests
```

## Code style

Keep host-neutral logic in TypeScript and host-specific scripts thin:

```ts
export interface HostLayout {
  appDir: string;
  colleagueDir: string;
  memoryDir: string;
  logDir: string;
}

export function resolveHostLayout(
  mode: "windows" | "macos" | "container",
  colleagueId: string,
): HostLayout;
```

- TypeScript stays strict and ESM.
- Public contracts use explicit input/output types and structured errors.
- Shell and PowerShell scripts fail on errors and quote every filesystem path.
- No host-specific path is embedded in colleague identity files.

## Testing strategy

- **Unit:** path resolution, env parsing, native skill metadata, MCP schema and
  error behavior, idempotency, redaction.
- **Integration:** start an echo-runtime colleague in a temporary directory,
  call the control MCP over STDIO, submit a turn, and verify persisted memory.
- **Workspace integration:** verify bounded Gmail/Outlook and Google/Outlook
  fixture results, account/provider selection, prompt-injection resistance, and
  scheduled read-only boundaries without requiring live credentials in CI.
- **Browser:** text send, SSE recovery, microphone permission denial, audio
  transcription review, playback, keyboard navigation, and responsive layouts
  in a real browser.
- **Packaging:** validate plugin manifest, marketplace paths, `.app.json`, and
  every native skill front matter.
- **Host smoke:** PowerShell tests on `windows-latest`, launchd/plist lint and
  shell tests on `macos-latest`, image build/run on Linux.
- **Manual:** install the repo marketplace in a new Codex task and verify every
  default skill plus each independently enabled connector appears.

## Boundaries

### Always

- Keep Person/Soul/Info portable and free of host paths and secret values.
- Validate external connector responses and MCP inputs at their boundaries.
- Require explicit human approval for external send, contract approval, or
  destructive operational actions.
- Redact tokens, email bodies, contract text, prompts, and memory from health
  and routine logs.
- Keep text chat operational when microphone, transcription, or speech playback
  is unavailable.

### Ask first

- Changing the Person/Soul/Info schema.
- Adding a machine-wide Windows service or privileged installer.
- Publishing a plugin outside a repo/local marketplace.
- Adding a remote identity, memory, queue, or secret service.

### Never

- Store connector tokens in plugin files, colleague YAML, Compose files, or
  command-line arguments.
- Treat a Codex connector as an inbound channel with delivery guarantees.
- Mount the Docker socket or run the container privileged.
- Allow a skill instruction to override deterministic channel, RBAC, or
  approval policy.
- Store raw microphone recordings or email attachments indefinitely by default.
- Expose Gmail, Outlook, Google Calendar, Outlook Calendar, Notion, Slack,
  Codex, or speech-provider credentials to browser code.

## Success criteria

- A clean clone runs the sample colleague with the echo runtime before any
  external account is configured.
- The same colleague directory passes `inspect` and runs in all three
  deployment modes.
- Windows and macOS installers are idempotent and their uninstallers preserve
  colleague identity and memory unless `--purge-data` is explicitly supplied.
- The Docker container runs as non-root, has a read-only root filesystem, and
  retains memory across container replacement.
- A fresh Codex installation can add the repo marketplace and install the
  default `digital-colleague-core`, `digital-colleague-builder`, and
  `digital-colleague-web` plugins.
- A developer can customize the configured colleague and generate a domain
  plugin for it, validate both, and install the result without changing core
  source code.
- `digital-colleague-workspace` and `ada-legal-ops` remain independently
  installable and are not required for the offline quickstart.
- Every skill has Codex-native `name` and `description` metadata.
- Gmail/Outlook Email, Google/Outlook Calendar, Notion, Slack, and
  `dcolleague-control` are independently enableable; failure of one connector
  does not prevent unrelated skills from loading.
- No committed artifact contains credential values; automated secret scanning
  and plugin/deployment verification pass.
- `submit_turn` is idempotent and audit events identify actor, colleague,
  action, outcome, timestamp, and request ID without leaking content.
- A browser user can type a message, receive a streamed response, record one
  utterance, review its transcript, submit it, and play a captioned audio reply.
- A scheduled inbox run states its provider, account, bounded time window, and
  visibility gaps, and performs no provider-side write.
- The same inbox and calendar skills work with either supported official
  provider; disconnecting one provider does not break the other or the offline
  quickstart.
- No Web API or MCP input requires a colleague selector or `colleagueId`.
- No runtime component implements colleague discovery, peer routing,
  a persistent agent roster, or team orchestration.
- Sub-agent execution, when used, is provided by Codex's native multi-agent
  capability and does not create additional digital-colleague identities.

## Open questions for review

1. Should the Windows Phase 0 default remain a per-user Scheduled Task, or must
   it run before user login as a machine service?
2. Will the Docker deployment authenticate Codex with a service credential, or
   is mounting a dedicated non-human Codex profile acceptable in the pilot?
3. Should generated domain plugins live inside the clone's `plugins/`
   marketplace by default, or be scaffolded as standalone repositories?
4. For the pilot, should voice remain review-before-send, or may users opt into
   automatic send after a successful transcription?
5. Is the web channel local/VPN-only in Phase 0, or must the first release
   include public SSO and internet exposure?
