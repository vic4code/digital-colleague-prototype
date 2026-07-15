# Architecture

This prototype is a concrete, runnable binding of the [digital-colleagues-architecture](https://github.com/vic4code/digital-colleagues-architecture) worldview, built on the [OpenClaw](https://github.com/openclaw/openclaw) framework model.

## The one idea

> **A digital colleague is a *role, not a session*.**

A raw LLM "has no existence *between* your prompts." The platform's job is to give it **continuity of existence** across conversations, people, and systems — to turn *"a mind I can talk to"* into *"a colleague the organization can work with."*

That continuity is what the **Person / Soul / Info** trilogy encodes, and what the gateway keeps alive.

## Identity: Person / Soul / Info

OpenClaw configures an assistant from injected files in a workspace (`SOUL.md`, `AGENTS.md`, `TOOLS.md`). This prototype generalizes that into three files that together *are* the colleague:

| File | Plane | Answers | Maps to |
|------|-------|---------|---------|
| `person.yaml` | **Person** — org-facing | *Who are you to the org?* name, role, manager, mandate | the architecture repo's "persona" as an org entity |
| `SOUL.md` | **Soul** — prompt-facing | *How do you think and behave?* voice, values, boundaries | OpenClaw's `SOUL.md` |
| `info.yaml` | **Info** — account-facing | *What can you reach and act as?* Gmail, Slack, permissions | OpenClaw channels + accounts, made explicit |

Plus two supporting planes:

- **Memory** — `memory/log.jsonl`: "persistent state across sessions: facts, preferences, prior decisions."
- **Skills** — `skills/<name>/SKILL.md`: bundled capabilities, exactly like OpenClaw workspace skills.

`Person + Soul + Info + Memory + Skills == a Colleague.`

## Logical architecture (cloud-agnostic)

Components are named by *what they do*, not by which product implements them. The standalone deployment collapses all of these into one process; the distributed deployment splits them along the same seams.

```
            ┌─────────────────────────────────────────────────────────────┐
   humans   │  EDGE            CONTROL PLANE        EXECUTION PLANE         │
  ───────►  │  channels    →   dispatch/routing  →  agent runtime          │
  Slack     │  (normalize      (RBAC, one path     (codex / claude-code)   │
  Gmail     │   → Turn)         per Turn)                                   │
  console   │      ▲                                     │                  │
            │      └───────────── reply ─────────────────┘                  │
            ├─────────────────────────────────────────────────────────────┤
            │  IDENTITY PLANE  ← "what makes a colleague a colleague"       │
            │  person · soul · info · memory · skills · secrets            │
            └─────────────────────────────────────────────────────────────┘
```

### How a Turn flows (standalone)

1. A **channel** adapter (`src/channels/*`) receives a message and normalizes it into a canonical **`Turn`**.
2. The **gateway** (`src/gateway/standalone.ts`) is the single dispatch path: it recalls **memory** for the thread, then calls the runtime.
3. The **agent runtime** (`src/runtime/agent.ts`) assembles the system prompt from Person + Soul + Info + Skills (`src/runtime/prompt.ts`) and produces a **`Reply`**.
4. The gateway persists both sides to **memory** and hands the reply back to the channel.

Every arrow in that flow is an interface (`Channel`, `AgentRuntime`, `MemoryStore`), which is what makes a colleague definition portable between standalone and distributed.

## Vendor neutrality

The architecture glossary names the runtimes explicitly: *"Codex / Claude Code / app-server — vendor agent runtimes we build on (no vendor lock at the platform layer)."* Here that's the `AgentRuntime` interface:

- `CodexAppServerRuntime` — binds to Codex's native long-lived `app-server`
  JSON-RPC protocol (`initialize`, `thread/start`, `turn/start`).
- `EchoRuntime` — dependency-free, key-free; proves the platform loop offline.
- `claude-code` — left as a parallel adapter behind the same interface.

Everything above that interface — identity, channels, memory, gateway — is vendor-neutral.
