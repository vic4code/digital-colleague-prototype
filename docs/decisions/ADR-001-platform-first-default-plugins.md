# ADR-001: Platform-first marketplace with default plugins

## Status

Proposed

## Date

2026-07-14

## Context

The prototype must be deployable on Windows, macOS, and Docker, but deployment
alone is not the product. Other teams should be able to clone the repository,
run a credential-free example, and extend it with their own colleague
definition, skills, and Codex-native plugins. Each clone has exactly one active
colleague; extensibility does not mean adding an agent team.

The first proposal centered the installable plugin on Ada Legal. That made the
example identity look like the platform contract and would force adopters to
remove or fork domain behavior before extending it.

The term "plugin" can also become ambiguous: Codex plugins are distribution
packages containing skills, apps, and MCP configuration, while a future Node
runtime extension would be executable code loaded by `dcolleague`.

## Decision

Make the repository a platform-first Codex plugin marketplace with five
independently installable packages:

1. `digital-colleague-core` — default operational skills and control MCP.
2. `digital-colleague-builder` — default templates and validation.
3. `digital-colleague-web` — default text/voice frontend channel setup.
4. `digital-colleague-workspace` — provider-neutral setup and automation skills
   for optional Google, Microsoft, Notion, and Slack plugins.
5. `ada-legal-ops` — optional example domain plugin.

Only Codex-native packages are called plugins in the initial public contract.
Runtime extensibility continues through the typed `Channel`, `AgentRuntime`,
and `MemoryStore` interfaces until a separately named and versioned runtime
extension contract is justified.

Use Codex's native `.codex-plugin/plugin.json` bundle as the distribution source
of truth. Do not maintain a parallel imitation manifest for the same skills and
MCP tools. Any future executable event adapter is a separately named, reviewed,
and versioned runtime package rather than a hidden plugin dependency.

Core, builder, and web must work without provider credentials. Workspace and
domain plugins must be removable without breaking deployment or offline
operation.

## Alternatives considered

### One Ada-specific plugin

- Pros: smallest initial package and concrete demo.
- Cons: couples platform installation to one identity and domain.
- Rejected: Ada should prove extensibility, not define the core.

### One monolithic plugin containing everything

- Pros: one install action.
- Cons: forces external authentication and Legal skills on every adopter;
  unrelated connector failures can disable the whole experience.
- Rejected: violates the credential-free quickstart and optional integration
  boundary.

### Use the same plugin contract for runtime JavaScript extensions

- Pros: one extension vocabulary.
- Cons: Codex manifests do not define executable Node loading, isolation, or
  compatibility; the shared name would hide different trust models.
- Rejected for Phase 0: retain typed internal seams and introduce a distinct
  runtime extension contract only when an external implementation needs it.

## Consequences

- A clone is useful offline and grows through supported templates rather than
  forks of core logic.
- Builder templates configure or replace the clone's single colleague; they do
  not register additional colleagues.
- Default plugin validation becomes a required release gate.
- Marketplace and template contracts are public APIs and require versioning.
- Connector installation and colleague service-account provisioning remain
  separate operational decisions.
