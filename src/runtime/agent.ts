import { spawn } from "node:child_process";
import type { Colleague, Turn, Reply } from "../colleague/types.js";
import type { MemoryEntry } from "./memory.js";
import { buildTurnPrompt } from "./prompt.js";

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
  ): Promise<Reply>;
}

/**
 * CodexRuntime — binds to the Codex CLI / app-server (the runtime called out
 * by name in the glossary). It shells to `$CODEX_BIN exec` with the assembled
 * prompt on stdin. This is deliberately thin: the prototype's value is the
 * platform layer around the runtime, not the runtime itself.
 *
 * Contract assumed: `codex exec --model <m>` reads a prompt from stdin and
 * writes the agent's reply to stdout. Adjust `buildArgs` to match your local
 * Codex build if its flags differ.
 */
export class CodexRuntime implements AgentRuntime {
  readonly name = "codex";
  constructor(
    private readonly bin = process.env.CODEX_BIN || "codex",
    private readonly model = process.env.CODEX_MODEL || "gpt-5-codex",
  ) {}

  private buildArgs(): string[] {
    return ["exec", "--model", this.model];
  }

  async respond(
    colleague: Colleague,
    history: MemoryEntry[],
    turn: Turn,
  ): Promise<Reply> {
    const { system, user } = buildTurnPrompt(colleague, history, turn);
    const prompt = `${system}\n\n---\n\n${user}\n`;
    const out = await this.exec(prompt);
    return { text: out.trim() || "(no output from codex runtime)" };
  }

  private exec(input: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, this.buildArgs(), {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (err) =>
        reject(
          new Error(
            `Failed to launch Codex runtime "${this.bin}": ${err.message}. ` +
              `Set CODEX_BIN, or use DC_AGENT_RUNTIME=echo for offline runs.`,
          ),
        ),
      );
      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`Codex runtime exited ${code}: ${stderr}`));
      });
      child.stdin.write(input);
      child.stdin.end();
    });
  }
}

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
      return new CodexRuntime();
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
