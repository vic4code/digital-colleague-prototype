import type { Colleague, Turn, Reply } from "../colleague/types.js";
import type { MemoryEntry } from "./memory.js";
import { CodexAppServerRuntime } from "./codex-app-server.js";

/**
 * AgentRuntime is the "brain" boundary. The architecture repo names the
 * vendor runtimes explicitly — "Codex / Claude Code / app-server … no vendor
 * lock at the platform layer." Everything above this interface (identity,
 * channels, memory, gateway) is vendor-neutral; only the implementations
 * below know how to talk to a specific agent runtime.
 */
export interface AgentRuntime {
  readonly name: string;
  respond(
    colleague: Colleague,
    history: MemoryEntry[],
    turn: Turn,
    onDelta?: (delta: string) => void,
  ): Promise<Reply>;
  readAccount?(): Promise<RuntimeAccountStatus>;
  startLogin?(type: RuntimeLoginType): Promise<RuntimeLoginStart>;
  close?(): Promise<void>;
}

export type RuntimeLoginType = "chatgpt" | "chatgptDeviceCode";

export interface RuntimeAccountStatus {
  available: boolean;
  requiresOpenaiAuth: boolean;
  account: null | {
    type: "apiKey" | "chatgpt" | "amazonBedrock";
    email?: string;
  };
}

export type RuntimeLoginStart =
  | { type: "chatgpt"; loginId: string; authUrl: string }
  | {
      type: "chatgptDeviceCode";
      loginId: string;
      verificationUrl: string;
      userCode: string;
    };

/**
 * EchoRuntime — a dependency-free, key-free runtime for smoke tests and demos.
 * It proves the whole platform loop (channel → prompt → memory → reply)
 * without any external agent. It reflects the colleague's identity so you can
 * see Person/Soul/Info were assembled correctly.
 */
export class EchoRuntime implements AgentRuntime {
  readonly name = "echo";
  async respond(
    colleague: Colleague,
    _history: MemoryEntry[],
    turn: Turn,
  ): Promise<Reply> {
    const { person } = colleague;
    return {
      text:
        `[echo runtime] ${person.name} (${person.role}) received on ` +
        `${turn.channel}: "${turn.text}". ` +
        `Bind a real runtime with DC_AGENT_RUNTIME=codex to actually reason.`,
    };
  }
}

export function makeRuntime(kind?: string): AgentRuntime {
  const k = (kind || process.env.DC_AGENT_RUNTIME || "echo").toLowerCase();
  switch (k) {
    case "codex":
      return new CodexAppServerRuntime();
    case "echo":
      return new EchoRuntime();
    case "claude-code":
      // Left as an exercise / parallel adapter; shares the same interface.
      throw new Error(
        "claude-code runtime adapter is not implemented in this prototype. " +
          "Use DC_AGENT_RUNTIME=codex or =echo.",
      );
    default:
      throw new Error(`Unknown agent runtime "${k}"`);
  }
}
