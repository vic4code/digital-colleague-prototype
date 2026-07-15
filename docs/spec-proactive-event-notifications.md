# Spec: Proactive event notifications

## Objective

Give Ada a reliable, provider-neutral path for showing a real proactive notice
in the web UI when an external service changes, without pretending that Codex
connectors are webhook receivers.

The first production-shaped slice is:

```text
provider webhook or OpenClaw relay
  -> authenticated event ingress
  -> validation + in-memory deduplication + bounded recent-event buffer
  -> browser SSE stream
  -> Ant Design notification + notification inbox
```

Codex app-server remains the execution runtime. It can triage or act on a
notification in a later, explicit turn, but it is not placed on the webhook
acknowledgement path.

## Tech stack

- Node.js `>=20.19` HTTP server with no new runtime dependency
- React `19.2.7`
- Ant Design `6.5.1`
- Vite `8.1.4`
- Vitest `4.1.10`
- Codex CLI/app-server `0.144.4` on the verified development host

## Commands

```bash
npm run dev:api
npm run dev:web
npm run test:api
npm run test:web
npm run typecheck
npm run typecheck:web
npm run build
npm run build:web
```

## Project structure

```text
src/http/server.ts                 HTTP routes and SSE transport
src/http/server.test.ts            API, auth, dedupe, replay, and stream tests
src/events/                        Normalized event contract and bounded store
web/src/api.ts                     Browser event-stream client
web/src/App.tsx                    Connection lifecycle and notification UI
web/src/App.test.tsx               User-visible notification behavior
docs/decisions/                    Durable architecture decisions
deploy/openclaw/                   Optional official OpenClaw gateway profile
```

## API contract

### `POST /api/v1/events`

Accepts one normalized event from a trusted relay. The request uses the same
header style as OpenClaw's official webhook surface:

```http
Authorization: Bearer <DC_EVENT_INGRESS_TOKEN>
Content-Type: application/json
```

```json
{
  "eventId": "provider-stable-event-id",
  "source": "gmail",
  "type": "message.created",
  "title": "New message needs attention",
  "summary": "A bounded, non-secret preview for the user",
  "occurredAt": "2026-07-15T13:00:00.000Z"
}
```

Rules:

- `eventId`, `source`, `type`, `title`, and `occurredAt` are required.
- `summary` is optional and bounded.
- Unknown fields are ignored rather than forwarded to the browser or model.
- The token is read from `DC_EVENT_INGRESS_TOKEN`; it is never committed.
- A valid new event returns `202 Accepted`.
- A duplicate `eventId` returns `200 OK` with `duplicate: true` and is not
  delivered twice.
- Invalid authentication returns `401`; invalid input returns `422`.
- The endpoint acknowledges after validation and enqueue, never after a Codex
  turn. This stays within providers' short acknowledgement windows.

### `GET /api/v1/events`

Returns the bounded recent event buffer for reconnect recovery. The initial
slice keeps at most 100 normalized events in process memory. It is not a durable
queue and must not be described as exactly-once delivery.

### `GET /api/v1/events/stream`

Opens a same-origin Server-Sent Events stream. It sends:

- `ready` when connected;
- `notification` for each accepted event;
- a comment heartbeat at a bounded interval so dead connections are detected;
- `retry: 3000` so the browser reconnects without a tight loop.

The frontend reconnects using the browser `EventSource` lifecycle and recovers
missed recent events through `GET /api/v1/events`.

## Connection lifecycle

The UI must not collapse all failures into `offline`.

```text
checking -> ready
ready -> busy          when a turn receives RUNTIME_BUSY
ready -> reconnecting  when event SSE drops but health still succeeds
any -> offline         only after health checks fail
busy/reconnecting -> ready after successful retry or stream reconnect
```

Cold Codex inference, runtime saturation, HTTP health, and event-stream health
are separate signals. A `429 RUNTIME_BUSY` must preserve the user's message and
must not mark the API offline.

## Frontend presentation

- A compact bell button in the existing top bar shows the unread count.
- A new event opens an Ant Design notification containing source, title, time,
  and bounded summary.
- The bell opens a small notification inbox ordered newest first.
- Notifications use `aria-live` and readable text; color is not the only status
  signal.
- Clicking a notice may copy its summary into the composer for an explicit Ada
  turn. The first slice does not autonomously grant tools or execute writes.
- Desktop, tablet, and 320px mobile layouts remain usable.

## Code style

Use discriminated event types and validate once at the HTTP boundary:

```ts
export interface ProactiveEvent {
  eventId: string;
  source: "gmail" | "outlook" | "calendar" | "slack" | "notion" | "system";
  type: string;
  title: string;
  summary?: string;
  occurredAt: string;
}
```

Keep provider payload parsing outside this contract. Provider adapters verify
their native signature/challenge, then emit this normalized shape.

## Testing strategy

- Unit tests: validation, bounded fields, constant-time token comparison,
  dedupe, and buffer eviction.
- API integration tests: unauthorized request, accepted event, duplicate event,
  SSE delivery, reconnect replay, payload limit, and slow Codex dispatch not
  blocking webhook acknowledgement.
- Frontend tests: notification toast, unread badge, inbox, event dedupe, busy vs
  offline copy, and reconnect state.
- Browser E2E: keep the page open, send a signed `curl` event, prove the notice
  appears without a user message, disconnect/restart the API, and prove recovery.
- Connection probe: record header time, first-delta time, completion time, and
  concurrent-turn status rather than reporting one ambiguous latency number.

## Provider capability boundary

| Service/tool | Official inbound mechanism | First-slice binding |
|---|---|---|
| Gmail | Gmail `watch` -> Google Cloud Pub/Sub; OpenClaw has official `webhooks gmail setup` | Prefer OpenClaw Gmail watcher; normalized relay into `/api/v1/events` |
| Outlook Email/Calendar | Microsoft Graph change notifications via webhook, Event Hubs, or Event Grid | Separate Graph relay owns validation challenge, lifecycle events, and renewal |
| Slack | Events API over signed HTTP or Socket Mode; OpenClaw has a Slack channel | Prefer OpenClaw Slack channel or Socket Mode locally |
| Notion | Public HTTPS integration webhook with verification token and HMAC signature | Separate verified relay, then normalized event |
| Google Calendar | Per-resource HTTPS push notification channel | Separate relay owns channel renewal and follow-up API fetch |
| Codex connector tools | Outbound read/action during a Codex turn | Never treated as inbound webhook transport |

## Boundaries

Always:

- Treat provider and relay payloads as untrusted.
- Verify authentication before parsing into a user-visible event.
- Bound body size, field length, subscriber count, buffer size, and heartbeat.
- Log stable event names, request IDs, source, result, and latency without body,
  token, email address, or message content.
- Preserve provider event IDs for idempotency and audit correlation.

Ask first:

- Enabling a public tunnel or non-loopback listener.
- Storing webhook secrets or OAuth credentials.
- Automatically starting a Codex turn from an inbound event.
- Sending OS/browser push notifications while the page is closed.

Never:

- Commit tokens or OAuth state.
- Send raw provider payloads directly to the browser or model.
- Wait for an LLM response before acknowledging a provider webhook.
- Claim exactly-once delivery from an in-memory dedupe buffer.

## Success criteria

- A signed local test event is acknowledged in under 100ms without invoking
  Codex and appears in an already-open browser without refresh.
- Re-sending the same `eventId` does not create a second UI notice.
- Dropping and restoring the API moves the UI through `reconnecting` and back to
  `ready`, with no console error loop and no lost buffered event.
- A concurrent turn returns a visible `busy` state, not `offline`.
- API and web tests, typechecks, builds, and real-browser checks pass.
- Documentation clearly distinguishes provider ingress, OpenClaw relay, Codex
  execution, and frontend delivery.

## Open questions

1. Should provider events automatically start a read-only Codex triage turn, or
   should the first release require the user to click "交給 Ada"?
2. Is in-app delivery while the page is open sufficient for the first release,
   or should the same change also add Web Push for page-closed notifications?

## Official sources

- Codex app-server protocol and event stream:
  https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- OpenClaw webhook authentication and routes:
  https://docs.openclaw.ai/webhook
- OpenClaw Gmail Pub/Sub helper:
  https://docs.openclaw.ai/cli/webhooks
- OpenClaw internal hooks:
  https://docs.openclaw.ai/automation/hooks
- Gmail push notifications:
  https://developers.google.com/workspace/gmail/api/guides/push
- Microsoft Graph change notifications:
  https://learn.microsoft.com/en-us/graph/change-notifications-overview
- Slack Events API and Socket Mode:
  https://docs.slack.dev/apis/events-api/
- Notion webhooks:
  https://developers.notion.com/reference/webhooks
- Google Calendar push notifications:
  https://developers.google.com/workspace/calendar/api/guides/push
