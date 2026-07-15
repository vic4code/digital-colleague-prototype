---
name: workspace-setup
description: Configure and verify a provider-neutral digital colleague workspace using official Gmail or Outlook Email and Google Calendar or Outlook Calendar connectors, with optional Notion and Slack, and distinguish connector access from event ingress. Use when a user asks to connect, switch, verify, explain workspace accounts and permissions, or make provider events proactively wake the colleague.
---

# Workspace Setup

Configure connector access for one digital colleague without introducing a
custom gateway. Follow the [official provider matrix](../../resources/provider-matrix.md)
and [workspace safety boundary](../../resources/safety-boundary.md).

## Setup workflow

1. Ask which official provider owns each capability:
   - email: Gmail or Outlook Email;
   - calendar: Google Calendar or Outlook Calendar;
   - optional knowledge context: Notion; and
   - optional conversation context: Slack.
   When the user asks for Microsoft 365 as a suite, route to
   `$m365-workspace-setup` from `digital-colleague-m365` so Teams,
   SharePoint/OneDrive, and Planner are verified alongside Outlook.
2. Collect the intended account address or human-readable account name,
   timezone, and normal workday. Do not ask for a password, token, cookie,
   authorization code, client secret, or pasted OAuth response.
3. Check whether the requested official connector/plugin is available. If it
   is missing, identify the exact official plugin the user needs to install or
   enable. Do not substitute web automation when an official connector exists.
4. Let the connector's own OAuth UI request consent. Explain requested scopes
   in plain language and prefer the narrowest scopes that satisfy the requested
   workflow.
5. Verify each connected capability with a bounded, read-only probe:
   - email: list a small recent window without changing read state;
   - calendar: list events in a short explicit window;
   - Notion or Slack: run a narrow search only if the optional source is wanted.
6. Confirm the connected identity from connector metadata when available. If
   the connector cannot report identity, ask the user to confirm what the
   connector UI shows rather than inferring it from message content.
7. Return a capability table with provider, account, access status, and any
   visibility limitation. Keep account selection in current Codex/workspace
   state; do not commit account identifiers or credentials to this repository.

## Multiple providers

Email and calendar providers may differ. When multiple email or calendar
accounts are connected, require an explicit provider/account choice for the
task. Never search or combine all accounts merely because they are available.

## Scheduling handoff

Reusable prompts live in
[resources/schedule-prompts](../../resources/schedule-prompts/). They do not
create an automation. The user installs and configures the actual schedule in
the official Codex/workspace scheduling surface, where timezone, frequency,
and enabled state remain visible and revocable.

Scheduled runs are read/summarize/draft-text-only. Any external write requires
fresh interactive approval for the exact action.

## Event-ingress handoff

A connector gives a running Codex turn access to provider data; it does not by
itself wake Codex. When the user requests immediate provider events, use the
optional, pinned profile documented in `deploy/openclaw/README.md` instead of
inventing a webhook server inside this skill.

- Gmail uses OpenClaw's official Pub/Sub setup.
- Slack uses OpenClaw's official channel, with stable-ID allowlists and mention
  gating.
- Notion database automation can send a token-authenticated POST only after its
  actual payload has been captured and mapped to the normalized receiver
  contract; do not assume top-level page or event ids.
- Outlook and Google Calendar mappings are receiver contracts only; do not
  claim provider-native push until the required provider validation and renewal
  path is configured.

Verify event ingress separately from connector OAuth. A successful connector
probe does not prove the provider can wake Ada, and an accepted webhook does not
prove the connector can fetch the referenced item.
