# Colleague spec

A digital colleague is a **directory**. This is the OpenClaw file-based
workspace idea: identity is a set of documents on disk, not code. This repo
loads exactly one active directory. To customize or replace that colleague,
edit `colleagues/ada/` or replace it with one `colleagues/<id>/` directory.

```
colleagues/<id>/
├── person.yaml              # PERSON — org-facing identity        (required)
├── SOUL.md                  # SOUL   — personality & behavior      (required)
├── info.yaml                # INFO   — accounts & channels         (required)
├── .agents/skills/
│   └── <skill>/SKILL.md     # Codex/OpenClaw AgentSkills          (optional)
└── memory/
    └── log.jsonl            # written at runtime, git-ignored
```

---

## `person.yaml` — PERSON

The org-facing identity. Data an org chart could render.

| Field | Req | Meaning |
|-------|-----|---------|
| `id` | ✓ | stable slug, unique per deployment |
| `name` | ✓ | display name |
| `handle` | ✓ | short org handle used across channels |
| `role` | ✓ | job title |
| `mandate` | ✓ | one paragraph: what the colleague is accountable for |
| `team` | | department |
| `reportsTo` | | human supervisor to escalate to |
| `timezone` | | IANA tz; proactivity respects it |
| `workingHours` | | `{ start, end, days }` |
| `pronouns` | | surfaced if the org wants them |

## `SOUL.md` — SOUL

Free-form markdown injected verbatim into the system prompt, with an optional
YAML front-matter header for the fields the *runtime* needs to reason about:

```yaml
---
voice: Precise, warm, and plain-spoken.
values: [ ... ]
boundaries:        # hard limits the colleague must never cross
  - Never send externally without human approval.
escalateWhen:      # conditions that trigger hand-off to person.reportsTo
  - Unlimited-liability clause.
---
# free-form soul below…
```

## `info.yaml` — INFO

The declared business identities and local channels the colleague uses.

> **Secrets never live here.** Official Gmail/Outlook Email,
> Google/Outlook Calendar, Notion, and Slack connectors own their OAuth state in
> Codex/ChatGPT. `info.yaml` records human-readable identity and policy only.

```yaml
accounts:
  gmail:
    provider: gmail
    address: ada@example.com
  slack:
    provider: slack
    address: "@ada"

channels:
  - kind: console                 # always available, no creds
    policy: open

permissions:                      # coarse RBAC scopes for the control plane
  - contracts:redline
  - email:draft
```

`doctor` validates any optional legacy adapter secret references that an
adopter explicitly adds; the default official connectors have no repository
secret references to resolve:

```bash
dcolleague doctor -c colleagues/ada
```

## `.agents/skills/<name>/SKILL.md`

Use the shared AgentSkills shape recognized by Codex and OpenClaw. `name` and
`description` are required; optional `scripts/`, `references/`, and `assets/`
stay beside `SKILL.md`. The prototype loader temporarily accepts the legacy
`skills/<name>/SKILL.md` and `summary`, but new work must use this native path
and metadata.

```yaml
---
name: contract-review
description: First-pass contract triage and redlining against the playbook.
---
# procedure…
```
