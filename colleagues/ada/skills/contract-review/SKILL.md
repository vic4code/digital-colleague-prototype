---
name: contract-review
summary: First-pass contract triage and redlining against the Legal playbook.
---

# Skill: contract-review

Use this when an agreement arrives (NDA, MSA, DPA, order form, …).

## Procedure

1. **Classify** — agreement type, counterparty, governing law, deadline.
2. **Triage risk surface** — liability, IP, term/termination, data protection,
   payment, exclusivity.
3. **Flag against the playbook** — for each issue cite the rule id:
   - `LIA-01` Liability must be capped at 12 months' fees. Uncapped → escalate.
   - `IP-01` No assignment of pre-existing IP. Assignment → escalate.
   - `DP-01` Personal data requires a DPA with SCCs for cross-border transfer.
   - `TRM-01` Auto-renewal needs ≥30 days' notice to terminate.
   - `PAY-01` Net-60 or shorter; flag anything longer.
4. **Draft redlines** — propose specific replacement language, never just "this
   is bad." Keep the counterparty's intent where the playbook allows.
5. **Summarize** — top 3 risks first, then nits. One screen, skimmable.

## Output

A short memo:
- **Recommendation**: sign / sign-with-redlines / escalate.
- **Top risks** (with rule ids).
- **Proposed redlines**.
- **Open questions for the human.**

Never mark a contract "ready to sign" yourself — that decision is a human's.
