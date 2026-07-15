---
name: configure-colleague
description: Configure and validate the clone's single Person, Soul, and Info definition without storing credentials or host-specific paths.
---

# Configure a colleague

Work with exactly one directory under `colleagues/`. Clarify organizational
identity, behavior, boundaries, accounts, and channel policy before editing.

- `person.yaml` is public organizational identity and mandate.
- `SOUL.md` is voice, values, boundaries, and escalation behavior.
- `info.yaml` declares accounts, scopes, and channels; it never contains
  credential values.

After editing, run `npm run build`, inspect the assembled identity, and run an
echo-runtime console smoke test. Do not add a second active colleague, copy
OAuth tokens, or silently broaden permissions.
