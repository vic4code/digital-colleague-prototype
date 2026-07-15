# ADR-002: Web voice and Gmail ingress preserve the channel boundary

## Status

Proposed; the Gmail ingress portion is superseded by
[ADR-006](./ADR-006-codex-native-automations-first.md) for Phase 0

## Date

2026-07-14

## Context

The starter platform needs a frontend where a person can type or speak to a
colleague. It also needs to notice mail sent to the colleague's Gmail account
without requiring an open Codex chat.

A full-duplex voice agent or a Codex Gmail connector could each create a second
agent loop outside the daemon. That would split memory, approvals, identity,
and delivery responsibility between multiple runtimes.

## Decision

Implement both as deterministic channels feeding the existing canonical Turn:

- The `web` channel accepts typed text or a reviewed speech transcript. Speech
  transcription happens before Turn creation; speech playback happens after a
  Reply completes.
- The `gmail` channel owns mailbox synchronization, sender policy, message
  fetching, deduplication, cursor persistence, retries, and thread mapping.
- Codex app connectors remain optional interactive tools. They do not provide
  background delivery guarantees.

Phase 0 voice is push-to-talk with review-before-send. Replies stream as text
over SSE and can be rendered to speech after completion.

Phase 0 Gmail uses incremental `history.list` polling. Pub/Sub `watch` may wake
an always-on server, but the same history reconciliation remains the source of
truth because notifications can be delayed or dropped.

## Alternatives considered

### Browser-to-realtime voice model

- Pros: lowest conversational latency and natural interruption.
- Cons: creates a second reasoning/tool runtime beside Codex and makes memory
  ownership ambiguous.
- Deferred: revisit after the canonical Turn path and approval model are proven.

### Browser speech recognition only

- Pros: minimal server work.
- Cons: inconsistent browser support and no controlled provider or audit path.
- Rejected: use `MediaRecorder` plus a server-side `SpeechProvider`.

### Use only the Codex Gmail connector

- Pros: no custom Gmail channel.
- Cons: requires an active interactive session and does not own incremental
  delivery, acknowledgement, deduplication, or restart recovery.
- Rejected: keep it as an optional human-facing tool.

## Consequences

- Text, voice, Gmail, Slack, and console share one gateway and memory model.
- Voice remains usable across Windows, macOS, and Docker through the browser.
- Raw audio and email attachments need explicit retention and size policies.
- Gmail cursor and deduplication state become durable operational state.
- Full realtime voice is intentionally not a Phase 0 feature.
