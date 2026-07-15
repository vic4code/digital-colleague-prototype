# Implementation plan: Proactive event notifications

## Overview

Implement the approved event-ingress-to-browser path in small vertical slices.
Each slice must leave `main` buildable and must be committed independently.

## Architecture decisions

- Use authenticated normalized ingress instead of embedding five provider
  verification protocols in the core server.
- Use SSE for server-to-open-browser delivery because the flow is one-way and
  same-origin; retain REST replay for reconnect recovery.
- Keep Codex app-server off the webhook acknowledgement path.
- Keep in-process buffering explicit and bounded; durable queueing is a later
  deployment concern.
- Model runtime health, busy state, and notification-stream health separately.

## Phase 1: Event ingress foundation

### Task 1: Define and test the bounded event store

Acceptance:

- Strict normalized event validation and allowlisted output fields.
- Deduplicate by stable `eventId` and retain at most 100 recent events.
- Unit tests fail before implementation and cover eviction and duplicates.

Verify:

```bash
npm run test:api -- --run src/events
npm run typecheck
```

Likely files: `src/events/events.ts`, `src/events/events.test.ts`.

### Task 2: Add authenticated ingress and replay APIs

Acceptance:

- `POST /api/v1/events` implements `401`, `422`, `202`, and duplicate `200`.
- `GET /api/v1/events` returns the bounded normalized buffer.
- Webhook acknowledgement does not await `dispatch`.
- Structured diagnostics expose request ID, outcome, source, and duration only.

Verify:

```bash
npm run test:api -- --run src/http/server.test.ts
npm run typecheck
```

Likely files: `src/http/server.ts`, `src/http/server.test.ts`, `src/cli.ts`.

## Checkpoint: Ingress

- API tests and typecheck pass.
- A signed curl event returns within 100ms.
- Duplicate curl event is not enqueued twice.

## Phase 2: Browser delivery

### Task 3: Add reconnecting SSE notification transport

Acceptance:

- `GET /api/v1/events/stream` emits ready, notification, retry, and heartbeat.
- Disconnect removes the subscriber and does not leak listeners.
- Reconnect can recover recent events through the replay endpoint.

Verify:

```bash
npm run test:api -- --run src/http/server.test.ts
npm run typecheck
```

Likely files: `src/http/server.ts`, `src/http/server.test.ts`.

### Task 4: Render Ant Design proactive notifications

Acceptance:

- New SSE events display a notification and increment an unread badge.
- The inbox is keyboard-accessible, responsive, and deduplicates events.
- "交給 Ada" prepares an explicit user-approved turn.

Verify:

```bash
npm run test:web
npm run typecheck:web
npm run build:web
```

Likely files: `web/src/api.ts`, `web/src/App.tsx`, `web/src/App.test.tsx`,
`web/src/styles.css`.

## Checkpoint: Proactive UI

- Signed event appears in the already-open UI without refresh.
- No browser console errors or accessibility regressions.
- Desktop, tablet, and 320px mobile screenshots are reviewable.

## Phase 3: Connection correctness

### Task 5: Separate busy, reconnecting, and offline states

Acceptance:

- Client preserves structured API error codes.
- `RUNTIME_BUSY` displays busy and keeps the API online.
- Health retry uses bounded backoff and restores ready state.
- Event SSE failure displays reconnecting without blocking chat.

Verify:

```bash
npm run test
npm run typecheck
npm run typecheck:web
npm run build
npm run build:web
```

Likely files: `web/src/api.ts`, `web/src/App.tsx`, `web/src/App.test.tsx`.

### Task 6: End-to-end connection and notification verification

Acceptance:

- Record cold and warm turn timings separately.
- Prove concurrent turn busy behavior is correctly presented.
- Restart API during an open browser session and prove SSE recovery.
- Confirm service health and no console error loop.

Verify:

```bash
curl http://127.0.0.1:8787/api/v1/health
npm test
npm run build
npm run build:web
```

Use Playwright CLI for the browser flow and save review artifacts under
`output/playwright/`.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Provider retries create duplicates | Duplicate user notices and turns | Stable event IDs plus bounded dedupe; durable store before production scale |
| Slow Codex turn blocks webhook | Provider retries and event loss | Ack after enqueue; never await Codex |
| Browser sleeps or closes | In-app SSE cannot deliver | Replay recent buffer; Web Push is an explicit later scope |
| Laptop sleeps | No 24/7 ingestion | Document always-on host requirement |
| Raw provider text contains prompt injection | Unsafe autonomous action | Normalize allowlisted metadata; explicit user turn; no automatic writes |
| Public endpoint exposes local runtime | Credential or execution risk | Keep core loopback; use reviewed provider relay/OpenClaw ingress and HTTPS |

## Human review gate

Implementation begins after the user confirms:

- in-app notification first, with Web Push deferred;
- explicit "交給 Ada" first, with autonomous read-only triage deferred;
- normalized authenticated ingress as the core contract, while provider-native
  verification remains in OpenClaw or separate reviewed adapters.
