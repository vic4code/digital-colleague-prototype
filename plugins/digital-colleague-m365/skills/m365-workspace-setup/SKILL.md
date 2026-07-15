---
name: m365-workspace-setup
description: Install, connect, and verify the complete official Microsoft 365 connector set for Codex: Outlook Email, Outlook Calendar, Microsoft Teams, and SharePoint including OneDrive and Planner coverage. Use when a user asks to set up, audit, reconnect, or explain M365 access and permissions.
---

# Microsoft 365 Workspace Setup

Use the [official capability matrix](../../resources/capability-matrix.md) and
[M365 safety boundary](../../resources/safety-boundary.md).

## Setup workflow

1. Confirm the Microsoft tenant/account and whether setup is an individual
   pilot, workspace-wide rollout, or audit of an existing connection. Never ask
   for a password, token, cookie, OAuth code, or Entra client secret.
2. Check these official plugins independently:
   - `outlook-email@openai-curated`
   - `outlook-calendar@openai-curated`
   - `teams@openai-curated`
   - `sharepoint@openai-curated`
3. If a plugin is absent, identify that exact plugin. Do not invent a OneDrive
   plugin: OneDrive file access routes through SharePoint. Planner workflows
   route through Teams.
4. Let each official app own OAuth and consent. For Business, Enterprise, or
   Edu, call out that an admin may need to enable the app, approve Microsoft
   Entra scopes, configure domain/RBAC restrictions, and review action control.
5. Ask whether Teams and SharePoint should use user-authenticated access, sync,
   or both. Keep their semantics separate:
   - Teams admin-managed sync is read-only retrieval and cannot stand in for
     live Teams/Planner actions.
   - SharePoint sync can cover OneDrive, subject to the connection mode and
     admin-managed scope constraints in the matrix.
6. Run one bounded read-only probe per connector:
   - Outlook Email: list up to 5 recent messages without changing read state.
   - Outlook Calendar: list a short explicit window in the selected timezone.
   - Teams: search a named chat/channel or a user-approved narrow recent scope.
   - SharePoint: discover a named site/library or list a small recent-document
     set; verify OneDrive only when that access is in the selected setup mode.
7. Return a table with `Official plugin`, `Plugin enabled`, `App enabled`,
   `Account accessible`, `Probe`, `Write policy`, and `Limitation`.

Do not report M365 as ready unless all four rows are separately verified. A
plugin can be installed while its app is disabled, inaccessible, awaiting
admin consent, connected to the wrong account, or restricted by tenant policy.
