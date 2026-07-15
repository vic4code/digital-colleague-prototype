import type { Colleague, Turn, Reply } from "../colleague/types.js";
import { makeChannel } from "../channels/index.js";
import { makeRuntime, type AgentRuntime } from "../runtime/agent.js";
import { MemoryStore } from "../runtime/memory.js";

/**
 * StandaloneGateway — the Phase 0 deployment. One process holds the whole
 * logical architecture collapsed onto a single machine:
 *
 *   Edge (channels) → Control plane (this dispatcher) →
 *   Execution (agent runtime) → Identity plane (colleague) + Memory
 *
 * It's the "single-machine prototype proving concept" from the architecture
 * roadmap. The distributed track (see distributed.ts) splits these same
 * boxes across processes/hosts behind a queue, but the interfaces are shared,
 * so a colleague definition runs unchanged on either.
 */
export interface GatewayOptions {
  runtime?: string;
  /** Writable state location when the colleague definition is read-only. */
  memoryDir?: string;
  /** Restrict to a subset of the colleague's channels. */
  channels?: string[];
}

export class StandaloneGateway {
  private readonly runtime: AgentRuntime;
  private readonly memory: MemoryStore;
  private readonly threadQueues = new Map<string, Promise<void>>();

  constructor(private readonly colleague: Colleague, private readonly opts: GatewayOptions = {}) {
    this.runtime = makeRuntime(opts.runtime);
    this.memory = new MemoryStore(
      colleague.dir,
      opts.memoryDir ?? process.env.DC_MEMORY_DIR,
    );
  }

  get runtimeName(): string {
    return this.runtime.name;
  }

  async close(): Promise<void> {
    await this.runtime.close?.();
  }

  /** The single dispatch path every channel funnels a Turn through. */
  dispatch = (
    turn: Turn,
    onDelta?: (delta: string) => void,
  ): Promise<Reply> => {
    const previous = this.threadQueues.get(turn.threadId) ?? Promise.resolve();
    const result = previous
      .catch(() => {})
      .then(() => this.handleTurn(turn, onDelta));
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.threadQueues.set(turn.threadId, settled);
    void settled.finally(() => {
      if (this.threadQueues.get(turn.threadId) === settled) {
        this.threadQueues.delete(turn.threadId);
      }
    });
    return result;
  };

  private handleTurn = async (
    turn: Turn,
    onDelta?: (delta: string) => void,
  ): Promise<Reply> => {
    // Recall thread history (memory plane).
    const history = this.memory.recall(turn.threadId);

    // Execute the turn (execution plane).
    const reply = await this.runtime.respond(
      this.colleague,
      history,
      turn,
      onDelta,
    );

    // Persist a complete exchange together. Failed runtime calls leave no
    // orphaned human message that would confuse the next turn.
    this.memory.appendMany([
      {
        at: turn.at,
        threadId: turn.threadId,
        role: "human",
        text: turn.text,
      },
      {
        at: new Date().toISOString(),
        threadId: turn.threadId,
        role: "colleague",
        text: reply.text,
      },
    ]);
    return reply;
  };

  async run(): Promise<void> {
    const bindings = this.colleague.info.channels.filter((c) =>
      this.opts.channels ? this.opts.channels.includes(c.kind) : true,
    );
    if (bindings.length === 0) {
      throw new Error(
        `No channels selected. Colleague declares: ` +
          `${this.colleague.info.channels.map((c) => c.kind).join(", ")}`,
      );
    }

    console.log(
      `[gateway:standalone] ${this.colleague.person.name} online — ` +
        `runtime=${this.runtime.name}, channels=${bindings.map((b) => b.kind).join(",")}`,
    );

    const channels = bindings.map((b) => ({ ch: makeChannel(b.kind), binding: b }));

    const shutdown = async () => {
      await Promise.all(channels.map(({ ch }) => ch.stop().catch(() => {})));
      await this.close().catch(() => {});
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Start every selected channel; they share one dispatch path.
    await Promise.all(
      channels.map(({ ch, binding }) => ch.start(this.colleague, binding, this.dispatch)),
    );
  }
}
