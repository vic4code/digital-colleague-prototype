---
name: m365-meeting-followup
description: Prepare a grounded Microsoft 365 meeting brief or follow-up from Outlook Calendar, Outlook Email, Teams, Planner, and SharePoint or OneDrive context. Use for meeting preparation, decision and action extraction, reply drafts, or reviewed follow-up execution.
---

# Microsoft 365 Meeting Follow-up

Apply the [M365 safety boundary](../../resources/safety-boundary.md).

## Workflow

1. Resolve one exact Outlook Calendar event and timezone. Confirm attendees,
   organizer, recurrence instance, status, and linked meeting/chat metadata.
2. Read the minimum supporting context:
   - related Outlook thread when a concrete subject, participant, or link ties
     it to the event;
   - the exact Teams meeting chat/channel or named conversation;
   - linked or explicitly selected SharePoint/OneDrive documents; and
   - the explicitly selected Planner plan when follow-up tasks belong there.
3. Extract decisions, open questions, commitments, owners, due dates, and
   evidence. Mark inferred owners or deadlines as uncertain.
4. Prepare reviewable artifacts separately:
   - plain-text Outlook reply or new-message draft;
   - Teams follow-up draft with exact DM/channel destination;
   - Planner task proposals with plan, bucket, title, owner, and due date;
   - calendar update proposal; and
   - SharePoint/OneDrive document change plan.
5. Do not perform any write merely because the user requested a brief or
   follow-up. For execution, show one exact action and obtain fresh approval.
6. After each approved write, re-read the target and verify the result before
   offering the next action.

Whole-file SharePoint Office updates require local format-preserving edits and
content plus visual/fidelity verification. If that verification path is not
available, stop rather than replacing a rich Office file with low-fidelity
content.
