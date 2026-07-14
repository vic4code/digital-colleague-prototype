import type { Colleague } from "../colleague/types.js";
import type { GatewayOptions } from "./standalone.js";

/**
 * DistributedGateway — the Phase 3 deployment (NOT implemented in this
 * prototype, by design). It is documented here so the shape is committed and
 * the standalone code stays honest about what it is collapsing.
 *
 * In the distributed topology the single process of StandaloneGateway is split
 * along the exact seams the logical architecture already draws:
 *
 *   ┌── Edge ──────────┐   ┌── Control plane ─────┐   ┌── Execution plane ──┐
 *   │ channel adapters │ → │ orchestrator +       │ → │ stateless worker    │
 *   │ (per-channel     │   │ dispatch queue       │   │ pool, one turn each │
 *   │  ingress pods)   │   │ (routing, RBAC)      │   │ + agent runtime     │
 *   └──────────────────┘   └──────────────────────┘   └─────────────────────┘
 *              ▲                      │                          │
 *              └── event/stream bus ──┴──────────────────────────┘
 *
 *   Identity plane (persona/soul/info/memory/secrets) and shared business
 *   state (docs, work state, audit) become networked services the workers
 *   read through the same interfaces the standalone gateway calls in-process.
 *
 * Because Colleague, Channel, AgentRuntime, and MemoryStore are all interfaces,
 * a colleague definition is portable: the only thing that changes between
 * standalone and distributed is *where* each box runs and *what* sits behind
 * the queue. See docs/deployment-distributed.md for the full design.
 */
export class DistributedGateway {
  constructor(_colleague: Colleague, _opts: GatewayOptions = {}) {}

  async run(): Promise<never> {
    throw new Error(
      "Distributed deployment is designed but not implemented in this " +
        "prototype (Phase 3). Use the standalone gateway. " +
        "See docs/deployment-distributed.md for the intended topology.",
    );
  }
}
