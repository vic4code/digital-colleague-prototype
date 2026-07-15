#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { loadColleague } from "./colleague/loader.js";
import { buildSystemPrompt } from "./runtime/prompt.js";
import { resolveAccount } from "./runtime/secrets.js";
import { StandaloneGateway } from "./gateway/standalone.js";
import { DistributedGateway } from "./gateway/distributed.js";
import { createTurnServer } from "./http/server.js";

const program = new Command();

program
  .name("dcolleague")
  .description(
    "Deploy and inspect digital colleagues — LLM agents with a persistent " +
      "Person, Soul, and Info (Gmail, Slack, …).",
  )
  .version("0.1.0");

program
  .command("run")
  .description("Bring a colleague online on its channels (standalone gateway).")
  .requiredOption("-c, --colleague <dir>", "path to the colleague directory")
  .option("-d, --deployment <mode>", "standalone | distributed", "standalone")
  .option("-r, --runtime <kind>", "agent runtime: codex | echo", process.env.DC_AGENT_RUNTIME)
  .option(
    "--channel <kinds>",
    "comma-separated channels to start (default: all declared)",
  )
  .action(async (opts) => {
    const colleague = loadColleague(opts.colleague);
    const channels: string[] | undefined = opts.channel
      ? String(opts.channel).split(",").map((s) => s.trim())
      : undefined;

    if (opts.deployment === "distributed") {
      await new DistributedGateway(colleague, { runtime: opts.runtime, channels }).run();
      return;
    }
    await new StandaloneGateway(colleague, { runtime: opts.runtime, channels }).run();
  });

program
  .command("serve")
  .description("Serve the local web turn API using Codex app-server.")
  .requiredOption("-c, --colleague <dir>", "path to the colleague directory")
  .option("-r, --runtime <kind>", "agent runtime: codex | echo", "codex")
  .option("-p, --port <number>", "localhost port", "8787")
  .action(async (opts) => {
    const port = Number.parseInt(String(opts.port), 10);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`Invalid port: ${opts.port}`);
    }

    const colleague = loadColleague(opts.colleague);
    const gateway = new StandaloneGateway(colleague, { runtime: opts.runtime });
    const server = createTurnServer({
      dispatch: gateway.dispatch,
      colleague: { id: colleague.person.id, name: colleague.person.name },
      runtime: gateway.runtimeName,
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        console.log(
          `[web] ${colleague.person.name} listening on http://127.0.0.1:${port} ` +
            `(${gateway.runtimeName})`,
        );
        resolve();
      });
    });

    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      server.close(() => {
        void gateway.close().finally(() => process.exit(0));
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });

program
  .command("inspect")
  .description("Show a colleague's assembled identity (Person / Soul / Info).")
  .requiredOption("-c, --colleague <dir>", "path to the colleague directory")
  .option("--prompt", "print the full assembled system prompt")
  .action((opts) => {
    const c = loadColleague(opts.colleague);
    if (opts.prompt) {
      console.log(buildSystemPrompt(c));
      return;
    }
    console.log(`PERSON`);
    console.log(`  ${c.person.name} <${c.person.handle}> — ${c.person.role}`);
    if (c.person.team) console.log(`  team: ${c.person.team}`);
    if (c.person.reportsTo) console.log(`  reports to: ${c.person.reportsTo}`);
    console.log(`  mandate: ${c.person.mandate}`);
    console.log(`\nSOUL`);
    console.log(
      "  " +
        c.soul.markdown.split("\n").slice(0, 6).join("\n  ") +
        (c.soul.markdown.split("\n").length > 6 ? "\n  …" : ""),
    );
    console.log(`\nINFO`);
    for (const [id, a] of Object.entries(c.info.accounts)) {
      console.log(`  account ${id}: ${a.provider}${a.address ? ` <${a.address}>` : ""}`);
    }
    console.log(`  channels: ${c.info.channels.map((ch) => ch.kind).join(", ")}`);
    console.log(`\nSKILLS`);
    if (c.skills.length === 0) console.log("  (none)");
    for (const s of c.skills) console.log(`  ${s.name}: ${s.summary}`);
  });

program
  .command("doctor")
  .description("Check a colleague's accounts resolve their secrets (like `openclaw doctor`).")
  .requiredOption("-c, --colleague <dir>", "path to the colleague directory")
  .action((opts) => {
    const c = loadColleague(opts.colleague);
    let problems = 0;
    console.log(`Checking ${c.person.name}'s accounts…\n`);
    for (const id of Object.keys(c.info.accounts)) {
      const r = resolveAccount(c.info, id);
      if (r.missing.length) {
        problems += r.missing.length;
        console.log(`  ✗ ${id} (${r.provider}): missing ${r.missing.join(", ")}`);
      } else {
        const declared = Object.keys(c.info.accounts[id].secrets ?? {}).length;
        console.log(
          `  ✓ ${id} (${r.provider}): ${declared} secret(s) resolved` +
            (r.address ? ` — ${r.address}` : ""),
        );
      }
    }
    console.log(
      problems === 0
        ? `\nAll accounts healthy.`
        : `\n${problems} unresolved secret(s). Set them in your environment / .env.`,
    );
    process.exit(problems === 0 ? 0 : 1);
  });

program.parseAsync(process.argv);
