---
name: web-channel-setup
description: Install, start, verify, and diagnose the reference React web surface and its loopback Codex app-server API.
---

# Web channel setup

The browser is an interaction surface, not an agent runtime. It sends canonical
turns to the loopback API and never receives Codex or connector credentials.

## Local development

1. Verify Node.js, npm, Codex CLI, and `codex login status`.
2. Run `npm install` once.
3. Start `npm run dev:api` and confirm
   `http://127.0.0.1:8787/api/v1/health`.
4. Start `npm run dev:web` and open `http://127.0.0.1:5173/`.
5. Verify a real browser message reaches the runtime before claiming readiness.

For a supervised install, use the repository's macOS, Windows, or Docker
adapter. Keep the API loopback-only unless a reviewed deployment boundary adds
authentication and TLS.
