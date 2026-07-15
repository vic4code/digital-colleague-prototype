# ADR-003: One colleague per clone and deployment

## Status

Accepted

## Date

2026-07-14

## Context

The prototype is intended to make one digital colleague deployable and
extensible. Language about selecting, discovering, or adding colleagues would
silently turn it into a multi-colleague platform and introduce registries,
routing, tenant boundaries, and team coordination that are not
needed to prove the product.

The colleague still needs multiple human-facing channels and many skills,
plugins, connectors, and accounts. Those are capabilities of one persistent
identity, not separate agents.

## Decision

One repository clone owns exactly one active colleague definition, and one
deployment serves exactly that colleague.

- Web, channel, and MCP requests address the configured colleague implicitly.
  Public contracts do not expose colleague lists or accept `colleagueId`.
- The builder configures or replaces the one Person/Soul/Info definition and
  scaffolds skills or plugins for it.
- Gmail, Slack, console, web text, and web voice all enter the same gateway,
  identity, memory, policy, and approval model.
- `person.team` is a human department label and `person.reportsTo` is a human
  escalation target. Neither creates an agent graph.
- Codex-native ephemeral sub-agents may execute bounded parts of a turn. They
  are not colleagues and receive no persistent identity, accounts, channels,
  or independent durable memory.
- Persistent agent rosters, peer routing, colleague discovery, colleague
  registries, custom team schedulers, and multi-tenant orchestration are out of
  scope.

## Consequences

- Deployment, API, authorization, UI, and memory ownership remain simple and
  auditable because there is no colleague selector or routing layer.
- Extensibility is deep rather than broad: adopters customize the identity and
  add capabilities around it.
- Scaling means improving availability or throughput for the same identity.
- A separate independent colleague requires a separate clone and deployment;
  coordinating those deployments is deliberately not a feature of this repo.
- Complex work can still be parallelized by the root colleague through Codex's
  native sub-agent lifecycle; no product-level team model is introduced.

## Alternatives considered

### Multiple colleagues in one deployment

- Pros: shared infrastructure and a single administration surface.
- Cons: requires tenancy, routing, identity selection, cross-agent policy, and
  operational isolation before the single-colleague value proposition is
  proven.
- Rejected: it expands the prototype into a different product.

### Single colleague now, implicit multi-colleague contracts

- Pros: could reduce future API migration.
- Cons: colleague IDs and selectors would leak unused complexity into every
  channel, tool, test, and screen and invite accidental team features.
- Rejected: future products can add an explicit gateway above independent
  deployments if that need is ever validated.
