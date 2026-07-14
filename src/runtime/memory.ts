import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Memory: "persistent state across sessions: facts, preferences, prior
 * decisions" (architecture glossary). This prototype uses a per-colleague
 * append-only JSONL log on disk — trivially inspectable and diff-friendly.
 * The distributed track would swap this for a shared memory service behind
 * the same interface (see docs/deployment-distributed.md).
 */
export interface MemoryEntry {
  at: string;
  threadId: string;
  role: "human" | "colleague";
  text: string;
}

export class MemoryStore {
  private readonly file: string;

  constructor(colleagueDir: string) {
    const memDir = join(colleagueDir, "memory");
    if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true });
    this.file = join(memDir, "log.jsonl");
  }

  append(entry: MemoryEntry): void {
    appendFileSync(this.file, JSON.stringify(entry) + "\n", "utf8");
  }

  /** Recent turns for a thread, oldest-first, capped at `limit`. */
  recall(threadId: string, limit = 20): MemoryEntry[] {
    if (!existsSync(this.file)) return [];
    const lines = readFileSync(this.file, "utf8").split("\n").filter(Boolean);
    const entries: MemoryEntry[] = [];
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as MemoryEntry;
        if (e.threadId === threadId) entries.push(e);
      } catch {
        /* skip malformed line */
      }
    }
    return entries.slice(-limit);
  }
}
