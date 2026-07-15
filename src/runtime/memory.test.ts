// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("MemoryStore", () => {
  it("can persist outside a read-only colleague definition", async () => {
    const root = await mkdtemp(join(tmpdir(), "dcolleague-memory-"));
    temporaryDirectories.push(root);
    const colleagueDir = join(root, "colleague");
    const memoryDir = join(root, "state");
    const store = new MemoryStore(colleagueDir, memoryDir);

    store.append({
      at: "2026-07-15T00:00:00.000Z",
      threadId: "web:test",
      role: "human",
      text: "hello",
    });

    expect(await readFile(join(memoryDir, "log.jsonl"), "utf8")).toContain("hello");
  });
});
