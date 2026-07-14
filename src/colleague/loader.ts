import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  Colleague,
  Person,
  Soul,
  Info,
  Skill,
} from "./types.js";

/**
 * Load a Colleague from a directory laid out as:
 *
 *   <dir>/
 *     person.yaml        (required)  — PERSON
 *     SOUL.md            (required)  — SOUL
 *     info.yaml          (required)  — INFO
 *     skills/<name>/SKILL.md  (any)  — SKILLS
 *     memory/                        — created at runtime
 *
 * This mirrors OpenClaw's file-based workspace model, where identity is a set
 * of documents on disk, not code.
 */
export function loadColleague(dirInput: string): Colleague {
  const dir = resolve(dirInput);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`Colleague directory not found: ${dir}`);
  }

  const person = loadPerson(join(dir, "person.yaml"));
  const soul = loadSoul(join(dir, "SOUL.md"));
  const info = loadInfo(join(dir, "info.yaml"));
  const skills = loadSkills(join(dir, "skills"));

  return { dir, person, soul, info, skills };
}

function requireFile(path: string, label: string): string {
  if (!existsSync(path)) {
    throw new Error(`Missing required ${label}: ${path}`);
  }
  return readFileSync(path, "utf8");
}

function loadPerson(path: string): Person {
  const raw = parseYaml(requireFile(path, "person.yaml")) as Partial<Person>;
  for (const field of ["id", "name", "handle", "role", "mandate"] as const) {
    if (!raw?.[field]) {
      throw new Error(`person.yaml is missing required field "${field}"`);
    }
  }
  return raw as Person;
}

/**
 * SOUL.md may carry an optional YAML front-matter block delimited by `---`.
 * Everything after it (or the whole file, if there is none) is the markdown
 * body injected into the prompt.
 */
function loadSoul(path: string): Soul {
  const content = requireFile(path, "SOUL.md");
  const fm = extractFrontMatter(content);
  return {
    markdown: fm.body.trim(),
    voice: fm.data.voice,
    values: fm.data.values,
    boundaries: fm.data.boundaries,
    escalateWhen: fm.data.escalateWhen,
  };
}

function loadInfo(path: string): Info {
  const raw = (parseYaml(requireFile(path, "info.yaml")) ?? {}) as Partial<Info>;
  const info: Info = {
    accounts: raw.accounts ?? {},
    channels: raw.channels ?? [],
    permissions: raw.permissions ?? [],
  };
  if (info.channels.length === 0) {
    // Every colleague is reachable at least on the console.
    info.channels.push({ kind: "console", policy: "open" });
  }
  return info;
}

function loadSkills(skillsDir: string): Skill[] {
  if (!existsSync(skillsDir)) return [];
  const skills: Skill[] = [];
  for (const entry of readdirSync(skillsDir)) {
    const skillDir = join(skillsDir, entry);
    if (!statSync(skillDir).isDirectory()) continue;
    const skillFile = join(skillDir, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const md = readFileSync(skillFile, "utf8");
    const fm = extractFrontMatter(md);
    skills.push({
      name: fm.data.name ?? basename(skillDir),
      summary: fm.data.summary ?? firstLine(fm.body),
      markdown: fm.body.trim(),
      dir: skillDir,
    });
  }
  return skills;
}

// --- tiny front-matter parser (no extra dependency) ------------------------
interface FrontMatter {
  data: Record<string, any>;
  body: string;
}

function extractFrontMatter(content: string): FrontMatter {
  const normalized = content.replace(/^﻿/, "");
  if (!normalized.startsWith("---")) {
    return { data: {}, body: normalized };
  }
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) {
    return { data: {}, body: normalized };
  }
  const yamlBlock = normalized.slice(3, end).trim();
  const body = normalized.slice(end + 4).replace(/^\r?\n/, "");
  let data: Record<string, any> = {};
  try {
    data = (parseYaml(yamlBlock) as Record<string, any>) ?? {};
  } catch {
    data = {};
  }
  return { data, body };
}

function firstLine(s: string): string {
  const line = s.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  return (line ?? "").replace(/^#+\s*/, "");
}
