# Digital Colleague Prototype

> A **deployable** prototype of a *digital colleague* — an LLM agent with a
> persistent **Person**, **Soul**, and **Info** (real accounts like **Gmail**
> and **Slack**) — built in the spirit of
> [**digital-colleagues-architecture**](https://github.com/vic4code/digital-colleagues-architecture)
> and on top of the [**OpenClaw**](https://github.com/openclaw/openclaw) framework model,
> with **Codex** as the agent runtime.

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

The **accounts** the colleague *is* — **Gmail**, **Slack**, and the channels
humans reach them on. This is the part you asked to highlight:

```yaml
accounts:
  gmail:                         # 📧 Ada's mailbox
    provider: gmail
    address: ada@acme.com
    secrets:                     # names only — values come from env, never git
      clientId: GMAIL_OAUTH_CLIENT_ID
      clientSecret: GMAIL_OAUTH_CLIENT_SECRET
      refreshToken: GMAIL_OAUTH_REFRESH_TOKEN
  slack:                         # 💬 Ada's Slack presence
    provider: slack
    address: "@ada"
    secrets:
      botToken: SLACK_BOT_TOKEN
      appToken: SLACK_APP_TOKEN

channels:
  - kind: console                # always on, no creds
  - kind: slack                  # authenticates as accounts.slack
    account: slack
    policy: pairing              # only paired humans may DM
  - kind: gmail
    account: gmail
    policy: allowlist
    allow: [ "*@acme.com" ]
```

> **🔒 Secrets never live in git.** `info.yaml` stores only the *names* of the
> environment variables that hold each credential. The colleague's whole
> identity — Person, Soul, Info — is versionable; her Gmail and Slack tokens are
> not. Check they resolve with `dcolleague doctor`.

Plus two supporting planes: **Memory** (`memory/log.jsonl` — facts and prior
decisions across sessions) and **Skills** (`skills/<name>/SKILL.md` — bundled
capabilities, like OpenClaw skills).

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

Wire up a real brain and real accounts:

```bash
cp .env.example .env                       # set CODEX_BIN, SLACK_*, GMAIL_*
node dist/cli.js doctor -c colleagues/ada  # verify every account resolves
DC_AGENT_RUNTIME=codex node dist/cli.js run -c colleagues/ada
```

### CLI

| Command | Purpose |
|---------|---------|
| `dcolleague run -c <dir>` | bring the colleague online on its channels |
| `dcolleague inspect -c <dir> [--prompt]` | show assembled Person/Soul/Info (or full prompt) |
| `dcolleague doctor -c <dir>` | check every account resolves its secrets |

---

## Deployable: standalone now, distributed by design

The architecture roadmap goes from a single-machine prototype to enterprise
scale. This repo implements the first and **designs** the last:

| Deployment | Status | What it is |
|------------|--------|------------|
| **Standalone** (Phase 0) | ✅ **implemented** | one process holds edge + control + execution + identity. See [docs/deployment-standalone.md](docs/deployment-standalone.md). |
| **Distributed** (Phase 3) | 📐 **designed, stubbed** | the same boxes split across ingress pods, a dispatch queue, and a stateless worker pool. See [docs/deployment-distributed.md](docs/deployment-distributed.md). |

Because every seam is an interface (`Channel`, `AgentRuntime`, `MemoryStore`),
**a colleague definition runs unchanged on either** — distributing the platform
is an infrastructure change, not an identity change.

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
├── colleagues/ada/            # 👩 an example colleague, fully specified
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
- **[OpenClaw](https://github.com/openclaw/openclaw)** — the *framework model*: a local-first gateway, the file-based workspace with an injected `SOUL.md`, `skills/<name>/SKILL.md`, channel adapters (Slack, …) with pairing/allowlist DM policies, and a `doctor` pre-flight. This repo adopts that model and extends `SOUL.md` into the full **Person / Soul / Info** trilogy.

> **Scope note.** This is a prototype. The console channel and the standalone
> gateway are fully live; the Slack and Gmail adapters implement the real
> **identity + credential path** (account resolution, Slack `auth.test`, Gmail
> OAuth secret binding) and document the remaining transport wire-up (Socket
> Mode / Gmail API poll) as the next step. The distributed gateway is a typed
> stub. Nothing here hides complexity behind a diagram — see each file's header.
