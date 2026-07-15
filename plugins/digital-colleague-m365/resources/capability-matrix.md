# Microsoft 365 official capability matrix

This bundle orchestrates official OpenAI-curated plugins. It does not register
its own Microsoft Entra application, proxy Microsoft Graph, duplicate connector
app IDs, or store OAuth credentials.

| Microsoft 365 surface | Official Codex plugin | Included workflows |
|---|---|---|
| Outlook mailbox, shared mailbox, attachments, drafts, and mailbox organization | `outlook-email@openai-curated` | inbox triage, thread/task extraction, reply drafts, shared mailbox routing |
| Outlook calendar and delegated/shared calendars | `outlook-calendar@openai-curated` | agenda, availability, meeting preparation, reviewed event changes |
| Teams chats/channels and Microsoft Planner tasks | `teams@openai-curated` | digest, notification triage, reply drafts, messages, Planner task workflow |
| SharePoint sites, libraries, Office files, and OneDrive-backed files | `sharepoint@openai-curated` | discovery, recent documents, file analysis, reviewed file and sharing changes |

There is no separate official `onedrive@openai-curated` plugin in the validated
marketplace snapshot. Route OneDrive requests through SharePoint. OpenAI's
SharePoint documentation says the sync app covers personal OneDrive files and
shared SharePoint drives, but admin-managed OneDrive sync is available only
when the workspace admin selects **sync all** and has the required SharePoint
admin permissions. A manually selected site/folder sync does not include
OneDrive.

## Installation and connection are separate

1. Install all four official plugins.
2. Ask a workspace admin to enable each underlying app and review its current
   action controls in Workspace settings when organizational policy requires it.
3. Each user completes the official OAuth flow for every user-authenticated app.
4. Verify each app with a bounded read-only probe.
5. Report `plugin`, `app enabled`, `account accessible`, and `probe result` as
   separate states. Never infer account access from plugin installation.

## Connection modes

- Outlook Email and Calendar are user-authenticated Microsoft Graph apps and
  support dedicated shared/delegated mailbox and calendar actions when the
  tenant grants the needed scopes.
- Teams self-service access can read and write through enabled actions. The
  admin-managed Teams sync option is a separate read-only retrieval mode and
  must not be described as message-send or Planner access.
- SharePoint supports user-authenticated access and plan-dependent sync.
  Admin-managed sync may require broad Microsoft application permissions and
  must be piloted when group-based permissions or complex inheritance matter.

Official references:

- https://help.openai.com/en/articles/12512241
- https://help.openai.com/en/articles/12552368-microsoft-teams-app-for-chatgpt
- https://help.openai.com/en/articles/12143177-sharepoint-connectors-on-chatgpt/
- https://help.openai.com/en/articles/11509118-admin-controls-security-and-compliance-in-connectors-enterprise-edu-and-team
