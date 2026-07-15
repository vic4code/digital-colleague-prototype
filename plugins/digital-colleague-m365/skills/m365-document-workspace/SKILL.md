---
name: m365-document-workspace
description: Find, review, and safely maintain Microsoft 365 documents across SharePoint and OneDrive using the official SharePoint connector. Use when the user asks for OneDrive files, SharePoint sites or libraries, Office document analysis, or a reviewed file update.
---

# Microsoft 365 Document Workspace

Use `sharepoint@openai-curated` for both SharePoint and supported OneDrive file
access. Apply the [M365 safety boundary](../../resources/safety-boundary.md).

## Workflow

1. State whether the target is a SharePoint site/library or the user's OneDrive.
   Do not infer OneDrive availability from plugin installation; verify the
   selected connection/sync mode using the capability matrix.
2. Resolve the exact site, drive, library, folder, or recent-document scope.
   If similarly named files exist, identify the intended file before fetching.
3. Read metadata first and fetch only the files required for the request.
   Respect permission, sync, sensitivity-label, file-size, and partial-index
   limitations returned by the official app.
4. For analysis, report exact file names and locations with source links when
   available. Distinguish live access from synced retrieval.
5. For writes, present the exact target and change before requesting approval.
   Preserve the real Office format and existing structure.
6. Treat `update_file` as a whole-file overwrite. Make rich Office edits on the
   real package, render/inspect when fidelity matters, upload only after QA, and
   re-fetch to verify the specific content and placement.
7. Treat move, rename, restore, delete, upload, sharing-link, invitation, and
   permission operations as separate important actions requiring fresh approval.

Do not claim a SharePoint site-selection setup includes OneDrive. OpenAI's
admin-managed OneDrive sync requires `sync all` plus the required SharePoint
admin permissions; user-authenticated and other sync modes must be reported as
the connector actually exposes them.
