# Deployment: Standalone (Phase 0)

The standalone deployment is the *"single-machine prototype proving concept"*
from the architecture roadmap. One Node process holds the entire logical
architecture — edge, control, execution, identity, memory — collapsed together.

This is the deployment implemented in this repo today.

## Prerequisites

- Node.js ≥ 20
- (optional) a Codex runtime on your PATH for real reasoning; otherwise the
  `echo` runtime runs everything offline.

## Run

```bash
npm install
npm run build

# Offline smoke test — talk to Ada in your terminal, no keys needed:
DC_AGENT_RUNTIME=echo node dist/cli.js run -c colleagues/ada --channel console

# With the Codex runtime:
cp .env.example .env      # set CODEX_BIN / CODEX_MODEL, channel secrets
DC_AGENT_RUNTIME=codex node dist/cli.js run -c colleagues/ada
```

## What "deployable" means here

`dcolleague run` is a long-lived process. In production you supervise it the
same way OpenClaw supervises its gateway — a user service:

- **systemd** (`systemctl --user`) or **launchd** on macOS.
- A container: `node dist/cli.js run -c /colleagues/ada` as the entrypoint,
  with secrets injected as environment variables.

One process serves **one colleague** across all its channels. To run several
colleagues, run several processes (or containers) — one per colleague
directory. That per-colleague isolation is exactly the seam the distributed
deployment formalizes.

## Operations

| Command | Purpose |
|---------|---------|
| `dcolleague run -c <dir>` | bring the colleague online on its channels |
| `dcolleague inspect -c <dir> [--prompt]` | show assembled identity / full prompt |
| `dcolleague doctor -c <dir>` | check every account resolves its secrets |

`doctor` is your pre-flight check (à la `openclaw doctor`): it exits non-zero if
any account is missing a declared secret, so it drops cleanly into CI or a
container healthcheck.

## Limits of standalone (why distributed exists)

- One process = one failure domain and one machine's worth of compute.
- Channels, dispatch, and execution share a process, so a slow turn blocks the
  edge.
- Memory and secrets are local files, not shared services.

The [distributed deployment](./deployment-distributed.md) splits these apart.
It is **designed but not implemented** in this prototype.
