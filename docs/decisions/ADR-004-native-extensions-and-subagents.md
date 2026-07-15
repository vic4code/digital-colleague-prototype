# ADR-004: Native extensions and ephemeral sub-agents

## Status

Accepted

## Date

2026-07-14

## Context

The clone must be easy to extend without inventing formats that Codex cannot
discover, validate, install, or secure. It must also let one digital colleague
handle complex work without turning the product into a persistent agent-team
platform.

Codex provides the AgentSkills `SKILL.md` model and a native plugin bundle
containing skills, MCP configuration, connectors, hooks, and assets.

The installed Codex CLI also exposes a stable `multi_agent` capability, so a
custom sub-agent scheduler would duplicate the runtime and create a second
compatibility surface.

## Decision

### Skills

- Canonical repo-local skills live at `.agents/skills/<name>/SKILL.md`.
- Every skill follows AgentSkills and requires `name` and `description`.
- Scripts, references, and assets live inside the skill directory and use
  relative paths.
- Legacy `colleagues/<id>/skills` loading is migration-only and warns.

### Plugins and connectors

- Distributable content uses `.codex-plugin/plugin.json` with `skills/` and
  optional `.mcp.json`, `.app.json`, `hooks/`, and `assets/`.
- The repo catalog uses `.agents/plugins/marketplace.json`.
- The repository does not publish a parallel compatibility manifest.
- Provider-event ingress, if later required, is a separately reviewed channel
  or event adapter. Phase 0 uses Codex Scheduled Tasks and official connectors.
- MCP remains the local tool/control boundary.

### Sub-agents

- The root Codex run is the digital colleague and may spawn native ephemeral
  sub-agents for bounded tasks.
- The repository does not implement its own spawn MCP, agent registry, roster,
  router, or scheduler.
- Child agents have no Person/Soul/Info, mailbox, public channel, or independent
  durable memory.
- The root colleague owns synthesis, approval checks, final delivery, and audit
  lineage.
- Native multi-agent support is feature-detected and optional. Unsupported or
  policy-disabled deployments fall back to single-agent execution.

## Consequences

- A skill or plugin can be validated with Codex-native tooling.
- Extension authors learn one primary package layout instead of a proprietary
  third format.
- One colleague can parallelize difficult work without acquiring persistent
  teammate identities or changing Web/MCP/channel contracts.
- Future executable event adapters and Codex content bundles remain visibly
  different trust and lifecycle boundaries.

## Sources

- https://learn.chatgpt.com/docs/build-skills
- https://learn.chatgpt.com/docs/build-plugins
- https://learn.chatgpt.com/docs/extend/mcp?surface=cli
