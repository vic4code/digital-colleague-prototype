# Deployment: Remote/HA (future) — one colleague only

> **Status: OUT OF PHASE 0 SCOPE and not implemented.**
> `src/gateway/distributed.ts` exists as a typed stub that throws with a pointer
> here. Any future implementation must preserve the singleton contract: it may
> distribute infrastructure for availability, but it still serves one identity.

This future mode splits the single standalone process along the exact seams the
[logical architecture](./architecture.md) already draws. It is a scale-up and
availability option for the same colleague, not a multi-agent or team platform.

## Topology

```
   humans
     │
     ▼
┌───────────────┐   Turn   ┌────────────────────┐  dispatch  ┌──────────────────┐
│ EDGE          │ ───────► │ CONTROL PLANE      │ ─────────► │ EXECUTION PLANE  │
│ channel       │          │ coordinator:       │  (queue)   │ stateless worker │
│ ingress pods  │ ◄─────── │ auth, ordering     │            │ pool; 1 turn each│
│ (slack, gmail)│  events  │ authorization      │ ◄───────── │ + agent runtime  │
└───────────────┘          └────────────────────┘  stream    └──────────────────┘
        ▲                            │                               │
        └──────── event/stream bus ──┴───────────────────────────────┘

   IDENTITY PLANE (networked services, read by workers through interfaces):
   persona store · soul · info · memory service · skill registry · secret store

   SHARED BUSINESS STATE:  document/artifact store · work-state (sprint board) · audit log
```

## What changes vs. standalone

| Concern | Standalone (today) | Distributed (this design) |
|---------|--------------------|---------------------------|
| Channels | in-process adapters | per-channel ingress pods that publish `Turn`s |
| Dispatch | a method call | a durable **dispatch queue** (one-way handoff) |
| Execution | same process | a **stateless worker pool**; each runs one turn then frees itself |
| Turn→reply | return value | **event/stream bus** carries live turn events back |
| Memory | `memory/log.jsonl` | a memory **service** behind the same `MemoryStore` interface |
| Secrets | env vars | a real **secret store** (Vault/SSM) behind the same resolver |
| Identity | files on disk | persona/soul/info **stores** the control plane reads |

## Why the prototype can defer it cheaply

Every seam above is already an **interface** in the code:

- `Channel` — swap in-process start/stop for an ingress pod + bus publisher.
- `AgentRuntime` — the worker already only needs `(colleague, history, turn) → reply`.
- `MemoryStore` — swap the JSONL file for a networked store; same two methods.
- secret resolution — swap `process.env` for a secret-store client.

So a colleague **definition** (`person.yaml` / `SOUL.md` / `info.yaml`) runs
**unchanged** on either deployment. Distributing the platform is an
infrastructure change, not an identity change — which is the whole point of the
"role, not a session" framing.

## Out of scope here (the actual TODO list)

- Queue + bus selection (e.g. NATS / SQS + a streaming transport).
- Worker sandboxing policy (OpenClaw's Docker/SSH sandbox model).
- HA for the identity/secret stores.
- Multi-colleague routing, persistent agent teams, and multi-tenant RBAC are
  explicitly outside this repository's scope. Ephemeral workers spawned by the
  root Codex run remain an internal native execution detail.
