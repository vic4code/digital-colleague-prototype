/**
 * The digital-colleague identity model.
 *
 * A digital colleague is a *role, not a session* (see docs/architecture.md).
 * Its identity is split into three files that live in the colleague's
 * directory — the same file-based "workspace" idea OpenClaw uses for
 * SOUL.md / AGENTS.md / TOOLS.md, extended into the Person / Soul / Info
 * trilogy this prototype is built around:
 *
 *   person.yaml  → PERSON : who they are to the organization  (org-facing)
 *   SOUL.md      → SOUL   : how they think and behave          (prompt-facing)
 *   info.yaml    → INFO   : what they can reach and act as     (account-facing)
 *
 * Person + Soul + Info + Memory + Skills == a Colleague.
 */

// ---------------------------------------------------------------------------
// PERSON — the org-facing identity. "A colleague the organization can work
// with." This is data an org chart could render: a name, a role, a manager,
// a mandate. Channel is metadata here, never identity.
// ---------------------------------------------------------------------------
export interface Person {
  /** Stable slug, unique within a deployment. e.g. "ada". */
  id: string;
  /** Human display name. e.g. "Ada Lovelace". */
  name: string;
  /** Short org handle used across channels. e.g. "@ada". */
  handle: string;
  /** Role / job title. e.g. "Legal Operations Analyst". */
  role: string;
  /** Team or department the colleague belongs to. */
  team?: string;
  /** The human (or colleague id) this colleague reports to / escalates to. */
  reportsTo?: string;
  /** One-paragraph mandate: what this colleague is accountable for. */
  mandate: string;
  /** Timezone the colleague operates in, IANA name. e.g. "Asia/Taipei". */
  timezone?: string;
  /** Coarse working hours; proactivity respects these. */
  workingHours?: { start: string; end: string; days?: string[] };
  /** Pronouns, if the org wants them surfaced. */
  pronouns?: string;
}

// ---------------------------------------------------------------------------
// SOUL — personality and behavior. Loaded from SOUL.md (free-form markdown,
// injected into the agent prompt) plus a small structured header for the bits
// the runtime needs to reason about (boundaries, escalation triggers).
// ---------------------------------------------------------------------------
export interface Soul {
  /** The full markdown body of SOUL.md, injected verbatim into the prompt. */
  markdown: string;
  /** Optional structured front-matter parsed out of SOUL.md. */
  voice?: string;
  values?: string[];
  /** Hard boundaries the colleague must never cross. */
  boundaries?: string[];
  /** Conditions under which the colleague hands off to `person.reportsTo`. */
  escalateWhen?: string[];
}

// ---------------------------------------------------------------------------
// INFO — the accounts, channels, and access the colleague *is*. This is the
// part the user specifically asked to highlight: gmail, slack, etc. Secrets
// are never stored here — only the *name* of the env var / secret-store key
// that holds them, so identity can live in git while credentials do not.
// ---------------------------------------------------------------------------
export interface AccountRef {
  /** Provider key. e.g. "gmail", "slack", "github", "linear". */
  provider: string;
  /** The account address/identifier as seen by humans. e.g. "ada@acme.com". */
  address?: string;
  /** Free-form label. e.g. "ACME workspace". */
  label?: string;
  /**
   * Names of secrets this account needs, resolved from the secret store /
   * env at runtime. Values are NEVER committed here.
   */
  secrets?: Record<string, string>;
  /** OAuth scopes / permission grants this account is limited to. */
  scopes?: string[];
}

export interface ChannelBinding {
  /** Channel kind. e.g. "console", "slack", "gmail". */
  kind: string;
  /** Which INFO account this channel authenticates as. */
  account?: string;
  /** DM / access policy, mirroring OpenClaw: "pairing" | "open" | "allowlist". */
  policy?: "pairing" | "open" | "allowlist";
  /** Explicit allowlist of who may reach the colleague on this channel. */
  allow?: string[];
  /** Channel-specific options passed through to the adapter. */
  options?: Record<string, unknown>;
}

export interface Info {
  /** Accounts the colleague owns / acts as. Keyed by account id. */
  accounts: Record<string, AccountRef>;
  /** Channels humans and colleagues reach it through. */
  channels: ChannelBinding[];
  /** Coarse capability scopes for business-level authorization (RBAC). */
  permissions?: string[];
}

// ---------------------------------------------------------------------------
// SKILL — a bundled capability, loaded from skills/<name>/SKILL.md, exactly
// like OpenClaw's workspace skills.
// ---------------------------------------------------------------------------
export interface Skill {
  name: string;
  /** One-line summary parsed from the SKILL.md header. */
  summary: string;
  /** Full markdown, injected when the skill is selected. */
  markdown: string;
  /** Directory the skill was loaded from. */
  dir: string;
}

// ---------------------------------------------------------------------------
// COLLEAGUE — the assembled whole.
// ---------------------------------------------------------------------------
export interface Colleague {
  /** Absolute path of the colleague's directory. */
  dir: string;
  person: Person;
  soul: Soul;
  info: Info;
  skills: Skill[];
}

// A single inbound/outbound unit of work. The architecture repo calls this a
// "canonical Turn event"; every channel normalizes into this shape.
export interface Turn {
  /** Which channel this turn arrived on. */
  channel: string;
  /** Stable conversation/thread id, so memory can be scoped. */
  threadId: string;
  /** Who sent it (human or colleague id). */
  from: string;
  /** The message text. */
  text: string;
  /** Arbitrary channel metadata (message ts, email headers, …). */
  meta?: Record<string, unknown>;
  /** ISO timestamp. */
  at: string;
}

export interface Reply {
  text: string;
  meta?: Record<string, unknown>;
}
