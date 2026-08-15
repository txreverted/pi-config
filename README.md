# pi-config

Private, version-controlled custom configuration for [pi](https://github.com/earendil-works/pi).

## Current UI

The `tools.ts` extension installs a minimal startup header and a single-line footer:

```text
π v0.84.2

[Extensions]
  tools.ts
[Context]
  AGENTS.md

────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────
~/Documents/pi-config 1m30       $0.000 (sub) 0.0%/272k (auto) gpt-5.6-sol xhigh
```

The footer shows the working directory, elapsed time, cost, subscription status, context usage, model, and thinking level.

## Install

Load this repository as a local user-scoped pi package:

```bash
pi install ~/Documents/pi-config
```

Set `quietStartup` to `true` in `~/.pi/agent/settings.json`; the extension supplies the replacement header.

## Structure

- `extensions/` — TUI and tool extensions
- `AGENTS.md` — project instructions loaded by pi
- `package.json` — pi package manifest

> Keep credentials out of Git. Authentication files, environment files, sessions, and local dependencies are ignored.
