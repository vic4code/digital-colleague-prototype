# ADR-006: Codex-native Automations first

## Status

Superseded for provider-event delivery by
[ADR-007](./ADR-007-event-driven-openclaw-codex-gateway.md). Still accepted as
the dependency-light polling option.

## Date

2026-07-14

## Context

The prototype needs one colleague that can periodically review mail and
calendars without requiring a human to start every run. ADR-005 selected an
OpenClaw Gateway as a required always-on trigger layer. That adds another
runtime, plugin trust boundary, credential store, network surface, and
cross-platform lifecycle to a prototype whose first goal is to validate the
colleague experience.

Codex Scheduled Tasks can run recurring work with installed plugins and skills.
OpenAI's documented inbox pattern periodically reviews mail and prepares drafts
for human review. Connector-only web tasks do not need a local folder or local
gateway. Tasks that use a local project require the computer to remain awake,
the project to remain on disk, and the Codex app to be running. Native provider
event triggers are not a general delivery mechanism for these connectors.

The product therefore needs a wake-up mechanism, but it does not need an
OpenClaw Gateway to validate Phase 0.

## Decision

Use Codex-native plugins, skills, connectors, and Scheduled Tasks as the Phase 0
runtime surface.

- Gmail, Google Calendar, Outlook Email, Outlook Calendar, and Notion use the
  official Codex plugins and their OAuth connections. Passwords and refresh
  tokens never enter this repository.
- Scheduled Tasks perform bounded periodic reads such as inbox triage, calendar
  briefs, and stale-work checks. They may prepare reviewable draft text in the
  task result, but must not create a provider-side draft during an unattended
  run.
- Scheduled work must not send mail, delete content, create or change calendar
  events, or update Notion without an approval-capable interactive run. A task
  prompt states this boundary explicitly.
- Google and Microsoft are optional providers behind the same mail/calendar
  skills; neither provider is a core runtime dependency.
- Connector-only proactive work uses a web Scheduled Task. Work that needs the
  clone's local files uses a local project task and documents its host-uptime
  requirement.
- The plugin packages skills and reusable prompt/resources; the schedule itself
  is user/workspace state created through the Codex UI or conversation. No
  undocumented `scheduledTasks` manifest field is introduced.
- The Phase 0 contract is periodic best-effort awareness, not immediate provider
  event delivery.
- The repository does not install, start, or require OpenClaw, `gog`, a custom
  scheduler, or a webhook gateway.
- If a future requirement needs provider-event latency, unattended server
  operation, durable retries, or delivery SLOs, add a separately reviewed event
  adapter behind the existing channel boundary. OpenClaw is one possible
  adapter, not the default dependency.

## Consequences

- A clone has fewer privileged dependencies and one OAuth/plugin trust surface.
- Connector-only web tasks can run without the clone or frontend being online.
- Local project tasks remain available on Windows and macOS but require the
  powered-on Codex desktop host; Docker does not inherit that local schedule.
- Mail and calendar checks are delayed by the configured schedule.
- Slack/Notion mentions and provider webhooks remain interactive or out of scope
  until an event adapter is explicitly approved.
- External communication remains human-controlled: automations prepare work;
  people approve consequential writes.

## Alternatives considered

### Required OpenClaw Gateway

- Pros: provider events, retry/state machinery, and always-on service features.
- Cons: adds a privileged runtime and security boundary before the interaction
  model is proven.
- Rejected for Phase 0; retained only as a future adapter option.

### Custom scheduler or polling daemon

- Pros: complete local control.
- Cons: duplicates official scheduling, authentication, retry, and lifecycle
  concerns and creates a proprietary extension surface.
- Rejected.

### No proactive execution

- Pros: smallest attack surface.
- Cons: cannot test whether the colleague notices routine work without being
  prompted.
- Rejected; bounded Scheduled Tasks provide the smallest useful proof.

## Sources

- https://learn.chatgpt.com/docs/automations?surface=app
- https://developers.openai.com/codex/use-cases/manage-your-inbox
- https://developers.openai.com/codex/plugins/
- https://help.openai.com/en/articles/11487775-connectors-in-chatgpt/
- https://learn.chatgpt.com/docs/agent-approvals-security
