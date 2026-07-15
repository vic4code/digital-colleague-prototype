# Official provider matrix

This plugin orchestrates official Codex plugins and connectors. It does not
bundle credentials or proxy OAuth. Immediate provider events are an independent
ingress concern; the optional OpenClaw profile is documented under
`deploy/openclaw/` and is not embedded in this content plugin.

| Capability | Supported official providers | Required |
|---|---|---|
| Email | Gmail or Outlook Email | Choose at least one |
| Calendar | Google Calendar or Outlook Calendar | Choose at least one |
| Knowledge context | Notion | Optional |
| Conversation context | Slack | Optional |
| Microsoft 365 suite | Outlook Email, Outlook Calendar, Microsoft Teams, and SharePoint | Use `digital-colleague-m365` for complete M365 setup and cross-product workflows |

The email and calendar choices are independent. A Google mailbox can be used
with an Outlook calendar, and vice versa. If more than one provider is
connected for a capability, the user must select the account or provider for
that task; do not silently merge accounts.

Authentication belongs to each official connector's OAuth flow. Never request
or store a password, OAuth authorization code, access token, refresh token, or
cookie in a prompt, repository file, environment variable created by this
plugin, or colleague memory.

## Event ingress

Connectors are tools used after a turn starts; they do not imply a webhook.

| Provider | Event path |
|---|---|
| Gmail | OpenClaw's Gmail Pub/Sub setup can wake Ada directly. |
| Slack | OpenClaw's official Slack channel can use HTTP Events or Socket Mode. |
| Notion | A database automation may send a token-authenticated POST, but its actual payload must first be captured and mapped to the normalized receiver contract; general integration webhook verification is not claimed. |
| Outlook | Use a reviewed Power Automate/Logic Apps forwarder, or a dedicated Graph relay that implements challenge, validation, and renewal. |
| Google Calendar | Use a Scheduled Task until a reviewed provider push adapter is selected. |

Every unattended event run follows `safety-boundary.md` and is read-only at
provider boundaries. Delivery is at-least-once unless a reviewed relay adds
durable provider-event deduplication.
