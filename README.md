# Digital Colleague Prototype

> A **deployable** prototype of a *digital colleague* — an LLM agent with a
> persistent **Person**, **Soul**, and **Info** (real accounts such as **Gmail**
> or **Outlook**, calendars, **Slack**, and **Notion**) — built in the spirit of
> [**digital-colleagues-architecture**](https://github.com/vic4code/digital-colleagues-architecture)
> informed by the [**OpenClaw**](https://github.com/openclaw/openclaw) workspace
> model, with **Codex-native plugins, connectors, and Automations** as the Phase 0
> runtime. OpenClaw remains optional and is now available as the pinned
> provider-event gateway profile.

This repository is intended to be a **cloneable starter platform**, not an
Ada-only application. Ada is the executable example; adopters should be able to
replace or customize the repository's **single colleague** and extend that
colleague with skills, Codex-native plugins, connectors, and channels without
modifying the core runtime.

> **Singleton boundary:** one clone and one deployment represent exactly one
> digital colleague. That colleague may use Codex-native ephemeral sub-agents
> while completing a turn, but this repository does not implement a persistent
> agent team, peer routing, or a colleague registry. `team` in `person.yaml` is
> human organization metadata only.

The target runtime is official-first and dependency-light: **Codex** owns
reasoning, native plugins/connectors, Scheduled Tasks, and ephemeral sub-agents.
Connector-only web tasks can run without the clone being online; tasks that need
local project files require the powered-on Codex desktop host. Consequential
writes remain reviewable. The local `dcolleague` process remains the executable
prototype and identity/diagnostic CLI, not a second scheduler or webhook
framework.

When immediate provider events are required, the optional OpenClaw profile
owns ingress, channel sessions, delivery, and audit while its official
OpenClaw Codex harness sends the actual agent turn to Codex app-server.
OpenClaw support for Codex is an OpenClaw capability, not an OpenAI-supported
OpenClaw product combination.

---

## The idea in one line

> **A digital colleague is a _role_, not a session.**

A raw LLM has *no existence between your prompts*. This platform gives it
**continuity** — a stable identity that persists across conversations, people,
and systems — turning *"a mind I can talk to"* into *"a colleague the
organization can work with."*

That identity is **Person + Soul + Info**.

---

## ⭐ What a digital colleague *has*: Person · Soul · Info

Every colleague is a **directory of documents** (the OpenClaw workspace idea —
identity is data on disk, not code). Three files, three planes:

### 🧑 PERSON — *who they are to the organization* → [`person.yaml`](colleagues/ada/person.yaml)

The org-facing identity. What an org chart would render.

```yaml
id: ada
name: Ada Lovelace
handle: "@ada"
role: Legal Operations Analyst
team: Legal
reportsTo: elena@acme.com        # who they escalate to
timezone: Asia/Taipei
mandate: >
  Own first-pass contract review for the Legal team…
```

### 🕯️ SOUL — *how they think and behave* → [`SOUL.md`](colleagues/ada/SOUL.md)

Personality, voice, values, and **hard boundaries** — injected verbatim into
the agent's prompt (this is OpenClaw's `SOUL.md`, kept by name).

```yaml
---
voice: Precise, warm, and plain-spoken.
boundaries:
  - Never send externally without human approval.
escalateWhen:
  - A contract contains an unlimited-liability clause.
---
# Ada's Soul
You are Ada, a Legal Operations Analyst. You are calm, exact, and helpful…
```

### 🔑 INFO — *what they can reach and act as* → [`info.yaml`](colleagues/ada/info.yaml)

The declared business identities and local channels the colleague uses. It is
not an OAuth or connector configuration store:

```yaml
accounts:
  gmail:                         # 📧 Ada's mailbox
    provider: gmail
    address: ada@example.com
  slack:                         # 💬 Ada's Slack presence
    provider: slack
    address: "@ada"

channels:
  - kind: console                # always on, no creds
```

> **🔒 Secrets never live in git.** Phase 0 workspace access uses the official
> Gmail or Outlook Email, Google Calendar or Outlook Calendar, Notion, and
> Slack plugins. Their OAuth sessions stay in Codex/ChatGPT and are never
> copied into `info.yaml`, an environment file, or the repository.

Plus two supporting planes: **Memory** (`memory/log.jsonl` — facts and prior
decisions across sessions) and **Skills** (`skills/<name>/SKILL.md` — bundled
capabilities, like OpenClaw skills).

The portable design converges local skills on the shared AgentSkills location
`.agents/skills/<name>/SKILL.md`. Codex discovers it natively. Reusable
distribution uses a Codex-native plugin bundle
(`.codex-plugin/plugin.json`, `skills/`, `.mcp.json`, and optional `.app.json`).

```
Person + Soul + Info + Memory + Skills  ==  a Colleague
```

---

## Quickstart (offline, no keys)

```bash
npm install
npm run build

# See Ada's assembled identity:
node dist/cli.js inspect -c colleagues/ada
node dist/cli.js inspect -c colleagues/ada --prompt   # the full system prompt

# Talk to her in your terminal (echo runtime — no API keys needed):
DC_AGENT_RUNTIME=echo node dist/cli.js run -c colleagues/ada --channel console
```

Use Codex as the interactive runtime:

```bash
DC_AGENT_RUNTIME=codex CODEX_BIN=codex \
  node dist/cli.js run -c colleagues/ada --channel console
```

Workspace accounts are connected separately through the official plugin OAuth
UI; do not put Gmail, Outlook, Calendar, Notion, or Slack credentials in
`.env`. Install the workspace plugin using the commands below.

### CLI

| Command | Purpose |
|---------|---------|
| `dcolleague run -c <dir>` | bring the colleague online on its channels |
| `dcolleague serve -c <dir> --runtime codex` | serve the loopback web API through Codex app-server |
| `dcolleague inspect -c <dir> [--prompt]` | show assembled Person/Soul/Info (or full prompt) |
| `dcolleague doctor -c <dir>` | check every account resolves its secrets |

---

## Deployable: standalone now, remote/HA later

The architecture roadmap starts with a single-machine prototype. Any later
remote or HA deployment still serves the same one colleague:

| Deployment | Status | What it is |
|------------|--------|------------|
| **Standalone** (Phase 0) | ✅ **implemented** | one process holds edge + control + execution + identity. See [docs/deployment-standalone.md](docs/deployment-standalone.md). |
| **Remote/HA** (future) | 📐 **out of Phase 0 scope** | infrastructure may be split for availability, but never becomes a multi-colleague control plane. See [docs/deployment-distributed.md](docs/deployment-distributed.md). |

Because every seam is an interface (`Channel`, `AgentRuntime`, `MemoryStore`),
**a colleague definition runs unchanged on either** — distributing the platform
is an infrastructure change, not an identity change.

### Proposed portable + Codex-native deployment

The next deployment slice is specified for **Windows native**, **macOS
native**, and **Docker**, together with a repo marketplace of default plugins,
a text/voice web channel, scheduled mail/calendar triage, connectors, and a control
MCP. The first implementation now includes the text/voice frontend and the
provider-neutral workspace plugin; host installers, the live conversation API,
and remaining default plugins follow the implementation plan:

- [Portable deployment and Codex-native spec](docs/spec-portable-codex-native-deployment.md)
- [Implementation plan](docs/implementation-plan-portable-deployment.md)
- [ADR-001: platform-first default plugins](docs/decisions/ADR-001-platform-first-default-plugins.md)
- [ADR-002: web and Gmail are channels](docs/decisions/ADR-002-web-and-gmail-are-channels.md)
- [ADR-003: one colleague per clone and deployment](docs/decisions/ADR-003-single-colleague-per-deployment.md)
- [ADR-004: native extensions and ephemeral sub-agents](docs/decisions/ADR-004-native-extensions-and-subagents.md)
- [ADR-005: official trigger and automation substrate](docs/decisions/ADR-005-official-trigger-substrate.md)
- [ADR-006: Codex-native Automations first](docs/decisions/ADR-006-codex-native-automations-first.md)
- [ADR-007: optional event-driven OpenClaw + Codex gateway](docs/decisions/ADR-007-event-driven-openclaw-codex-gateway.md)

### Text and voice frontend prototype

```bash
npm run dev:api
# in another terminal
npm run dev:web
# open http://127.0.0.1:5173
```

The responsive single-colleague UI sends text through a loopback-only HTTP
channel into a long-lived, native Codex `app-server` thread. The browser never
receives Codex credentials or direct app-server access. Conversation memory is
kept under the colleague directory and the UI preserves its opaque thread id
for the browser session.

Browser microphone capture and review-before-send UI are present. A completed
recording currently targets the bounded `POST /api/v1/audio/transcriptions`
contract; selecting the native Codex realtime-audio provider for that endpoint
is the next voice slice. Verify the working text path with `npm test`,
`npm run typecheck`, `npm run typecheck:web`, `npm run build`, and
`npm run build:web`.

### Install the Codex-native workspace plugin

```bash
codex plugin marketplace add .
codex plugin add digital-colleague-workspace@digital-colleague-prototype
```

The plugin adds `workspace-setup`, `inbox-triage`, and `calendar-brief`. Connect
at least one official email provider (Gmail or Outlook Email) and one official
calendar provider (Google Calendar or Outlook Calendar) through OAuth in the
Codex/ChatGPT Apps UI. Notion and Slack are optional. Reusable Scheduled Task
prompts live under
`plugins/digital-colleague-workspace/resources/schedule-prompts/`; schedules
themselves remain visible, revocable user/workspace state rather than plugin
manifest data.

### Provider events without an open frontend

The optional [event gateway profile](deploy/openclaw/README.md) pins OpenClaw,
`@openclaw/codex`, and `@openclaw/slack` to `2026.7.1`. It includes:

- Gmail Pub/Sub wake-up through OpenClaw's official setup;
- Slack HTTP Events with signature verification, stable-ID allowlists, and
  mention gating;
- authenticated fixed-route mappings with isolated sessions for normalized
  Notion, Outlook Email/Calendar, and Google Calendar events;
- explicit native Codex connector allowlists that decline app actions marked
  destructive, plus a read-only event worker whose dynamic exec/file/PDF tools
  are removed and whose remaining exec approvals fail closed;
- bounded payloads, separate gateway/hook tokens, 7-day session retention, and
  an optional Computer Use patch that disables event ingress; and
- a digest-pinned Docker Compose profile with a path-allowlisting ingress for
  an always-on host.

Not every mapping is a complete provider subscription. Outlook Graph still
needs validation and renewal handling, and Google Calendar has no native
OpenClaw push setup in the pinned release. The deployment guide marks each
end-to-end boundary explicitly instead of treating a receiver route as a
finished connector. The stock Docker image also lacks the Gmail watcher
dependencies, so Gmail push is host-native until a reviewed image/sidecar is
added.

---

## How a message flows (standalone)

```
 human ─▶ channel ─▶ gateway ─▶ agent runtime ─▶ reply ─▶ channel ─▶ human
 (Slack   normalize   recall     assemble prompt   persist
  Gmail   → Turn)      memory     from Person+       memory
  console             + dispatch  Soul+Info+Skills   (both sides)
```

1. A **channel** (`src/channels/`) normalizes an inbound message into a canonical `Turn`.
2. The **standalone gateway** (`src/gateway/standalone.ts`) recalls thread **memory** and dispatches.
3. The **agent runtime** (`src/runtime/`) — **Codex**, or `echo` offline — assembles the prompt from Person + Soul + Info + Skills and replies.
4. The gateway persists both sides to memory and sends the reply back out.

---

## Layout

```
digital-colleague-prototype/
├── colleagues/ada/            # 👩 the one active colleague (Ada is the example)
│   ├── person.yaml            #   PERSON
│   ├── SOUL.md                #   SOUL
│   ├── info.yaml              #   INFO (gmail + slack)
│   └── skills/contract-review/SKILL.md
├── src/
│   ├── colleague/             # identity types + directory loader
│   ├── runtime/               # agent runtimes (codex/echo), prompt, memory, secrets
│   ├── channels/              # console, slack, gmail adapters
│   ├── gateway/               # standalone (impl) + distributed (stub)
│   └── cli.ts                 # `dcolleague`
└── docs/                      # architecture + colleague spec + deployment
```

---

## Relationship to the references

- **[digital-colleagues-architecture](https://github.com/vic4code/digital-colleagues-architecture)** — the *worldview*: colleague-as-role, the cloud-agnostic logical architecture (edge / control / execution / **identity plane**), the phased standalone→distributed roadmap, and vendor-neutral runtimes ("Codex / Claude Code / app-server, no vendor lock"). This repo is a running binding of it.
- **[OpenClaw](https://github.com/openclaw/openclaw)** — the optional event and channel host plus a design reference for the file-based workspace, `SOUL.md`, skills, channel policies, and pre-flight checks. Scheduled-only Phase 0 does not require it; provider-event Phase 0.5 uses the pinned profile under `deploy/openclaw/`.

> **Scope note.** This is a prototype. The console channel and the standalone
> gateway are fully live. The Slack and Gmail adapters prove the legacy
> **identity + credential path**, but Phase 0 workspace access now prefers the
> official Codex plugins and Scheduled Tasks described in ADR-006. Immediate
> event delivery uses the optional ADR-007 OpenClaw profile instead of the
> legacy in-process channel stubs; the distributed gateway remains a typed
> stub.
