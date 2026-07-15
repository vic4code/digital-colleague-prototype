import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface MarketplaceEntry {
  name: string;
  source: { source: string; path: string };
  policy: { installation: string; authentication: string };
}

function skillFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return skillFiles(path);
    return name === "SKILL.md" ? [path] : [];
  });
}

describe("Codex plugin marketplace packaging", () => {
  const marketplacePath = join(repoRoot, ".agents/plugins/marketplace.json");
  const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8")) as {
    plugins: MarketplaceEntry[];
  };

  it("publishes the credential-free defaults and optional workspace bundles", () => {
    expect(marketplace.plugins.map((plugin) => plugin.name)).toEqual([
      "digital-colleague-core",
      "digital-colleague-builder",
      "digital-colleague-web",
      "digital-colleague-workspace",
      "digital-colleague-m365",
      "ada-legal-ops",
    ]);
    expect(
      marketplace.plugins
        .filter((plugin) => plugin.policy.installation === "INSTALLED_BY_DEFAULT")
        .map((plugin) => plugin.name),
    ).toEqual([
      "digital-colleague-core",
      "digital-colleague-builder",
      "digital-colleague-web",
    ]);
  });

  it("resolves every local plugin manifest and Codex-native skill", () => {
    for (const entry of marketplace.plugins) {
      expect(entry.source.source).toBe("local");
      const pluginDir = resolve(repoRoot, entry.source.path);
      const manifestPath = join(pluginDir, ".codex-plugin/plugin.json");
      expect(existsSync(manifestPath), `${entry.name} manifest`).toBe(true);

      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        name: string;
        skills: string;
      };
      expect(manifest.name).toBe(entry.name);
      const skills = skillFiles(resolve(pluginDir, manifest.skills));
      expect(skills.length, `${entry.name} skills`).toBeGreaterThan(0);
      for (const skill of skills) {
        const markdown = readFileSync(skill, "utf8");
        const frontMatter = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
        expect(frontMatter).toMatch(/^name:\s*[^\n]+$/m);
        expect(frontMatter).toMatch(/^description:\s*[^\n]+$/m);
      }
    }
  });
});
