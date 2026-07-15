// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("portable host packaging", () => {
  it("pins and hardens the standalone Docker runtime", () => {
    const dockerfile = read("Dockerfile");
    const compose = read("compose.yaml");

    expect(dockerfile).toContain("CODEX_VERSION=0.144.4");
    expect(dockerfile).toContain("USER 10001:10001");
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).toContain("./colleagues/ada:/opt/dcolleague/colleague:ro");
    expect(compose).toContain("ada-memory:/var/lib/dcolleague/memory");
  });

  it("keeps Windows secrets out of task arguments and uses a bounded logon task", () => {
    const installer = read("deploy/windows/install.ps1");
    const runner = read("deploy/windows/run-colleague.ps1");

    expect(installer).toContain("New-ScheduledTaskTrigger -AtLogOn");
    expect(installer).toContain("-RestartCount 5");
    expect(installer).not.toMatch(/-Argument[^\n]*(TOKEN|SECRET|PASSWORD)/i);
    expect(runner).toContain("$env:DC_MEMORY_DIR = $MemoryDir");
    expect(runner).toContain("Start-Transcript -Append");
    expect(runner).toContain("--web-root");
    expect(runner).toContain("codex login status");
  });
});
