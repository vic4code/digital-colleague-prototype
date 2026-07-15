---
name: m365-daily-brief
description: Build one bounded Microsoft 365 work brief across Outlook Email, Outlook Calendar, Teams, Planner, and SharePoint or OneDrive. Use for morning briefs, daily priorities, cross-product follow-up review, or scheduled M365 summaries.
---

# Microsoft 365 Daily Brief

Apply the [M365 safety boundary](../../resources/safety-boundary.md). Resolve
the selected account, timezone, Teams sources, Planner plans, and document
locations before reading. Do not silently search an entire tenant.

## Read workflow

1. Outlook Email: inspect the prior 24 hours or another explicit window. List
   at most 50 candidates and open at most 10 full messages.
2. Outlook Calendar: query an explicit half-open local-day range and inspect at
   most 50 events. Preserve tentative, out-of-office, focus, and free/busy
   semantics when available.
3. Teams: inspect only named chats/channels or a previously approved source
   set, with at most 50 message candidates. Treat reply-needed as an inference.
4. Planner: inspect at most 50 tasks from explicitly selected plans/buckets.
   Separate user-owned, delegated, overdue, and blocked work.
5. SharePoint/OneDrive: list at most 25 recent or explicitly relevant documents.
   Prefer exact site/library/folder context and distinguish synced search from
   live connector visibility.
6. Correlate sources only on grounded evidence such as an exact meeting title,
   participant, project name, message link, task reference, or document URL.
   Do not merge similarly named work based on guesswork.

## Output

Return:

1. top priorities with source and confidence;
2. agenda, conflicts, and useful free windows;
3. Outlook and Teams items likely needing a reply;
4. Planner deadlines, owners, and blockers;
5. documents likely needed today; and
6. account, query-window, truncation, sync, or permission limitations.

The brief is read-only, including in a scheduled run. Suggested replies,
messages, task updates, and event changes remain text in the result until an
interactive user approves one exact provider action.
