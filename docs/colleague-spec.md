# Colleague spec

A digital colleague is a **directory**. This is the OpenClaw file-based
workspace idea: identity is a set of documents on disk, not code. To create a
new colleague, copy `colleagues/ada/` and edit the files.

```
colleagues/<id>/
├── person.yaml              # PERSON — org-facing identity        (required)
├── SOUL.md                  # SOUL   — personality & behavior      (required)
├── info.yaml                # INFO   — accounts & channels         (required)
├── skills/
│   └── <skill>/SKILL.md     # bundled capabilities                (optional)
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
| `reportsTo` | | human/colleague to escalate to |
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

The accounts and channels the colleague **is** — the part to pay attention to.

> **Secrets never live here.** Each account lists the *names* of the env vars /
> secret-store keys that hold its credentials. That's what lets the whole
> identity live in git while Gmail and Slack credentials do not.

```yaml
accounts:
  gmail:                          # account id, referenced by channels
    provider: gmail
    address: ada@acme.com
    scopes: [ https://www.googleapis.com/auth/gmail.modify ]
    secrets:                      # key → ENV VAR NAME (not the value!)
      clientId: GMAIL_OAUTH_CLIENT_ID
      clientSecret: GMAIL_OAUTH_CLIENT_SECRET
      refreshToken: GMAIL_OAUTH_REFRESH_TOKEN
  slack:
    provider: slack
    address: "@ada"
    secrets:
      botToken: SLACK_BOT_TOKEN
      appToken: SLACK_APP_TOKEN

channels:
  - kind: console                 # always available, no creds
    policy: open
  - kind: slack                   # authenticates as accounts.slack
    account: slack
    policy: pairing               # pairing | open | allowlist
    allow: [ elena@acme.com, "#legal-intake" ]
  - kind: gmail
    account: gmail
    policy: allowlist
    allow: [ "*@acme.com" ]

permissions:                      # coarse RBAC scopes for the control plane
  - contracts:redline
  - email:draft
```

Verify an account's secrets resolve without starting the colleague:

```bash
dcolleague doctor -c colleagues/ada
```

## `skills/<name>/SKILL.md`

Same shape as OpenClaw skills: an optional `name` / `summary` header and a
markdown procedure injected when the skill is relevant.

```yaml
---
name: contract-review
summary: First-pass contract triage and redlining against the playbook.
---
# procedure…
```
