---
name: create-domain-plugin
description: Scaffold and validate an independently installable Codex domain plugin with a manifest, native skill metadata, and repo marketplace entry.
---

# Create a domain plugin

Use the templates bundled under `templates/domain-plugin/` as the minimum
shape. Normalize the plugin name to lower-case kebab-case and keep it distinct
from existing marketplace entries.

1. Create `plugins/<name>/.codex-plugin/plugin.json`.
2. Create one focused `skills/<skill-name>/SKILL.md` with `name` and
   `description` front matter.
3. Add a repo marketplace entry with a `./plugins/<name>` source path.
4. Default domain plugins to `AVAILABLE` and `ON_USE` unless authentication is
   explicitly required during installation.
5. Run the repository plugin packaging test and `codex plugin marketplace list`.

Never place credentials, customer content, or colleague memory in a plugin.
Ask before publishing outside the repo marketplace.
