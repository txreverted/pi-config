# pi-config

Private, version-controlled custom configuration for [pi](https://github.com/earendil-works/pi).

## Current UI

The `ui.ts` extension replaces the startup chrome and footer with one compact, sticky line directly above the editor:

```text
π v0.84.2 > ~/Documents/pi-config(main) > gpt-5.6-sol (xhigh) > 0.0%/272k (auto) > $0.000 (sub)
────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────
```

The line shows the working directory and git branch, model and thinking level, context usage, cost, and subscription status. It stays docked to the editor while messages, working indicators, tool calls, and diffs render above it. Extensions and context files remain fully loaded but are not listed in the UI.

The `neutral` theme keeps the UI mostly monochrome with white and gray tones, while retaining green and red for added and removed diff lines. Thinking-level borders brighten progressively from dark gray for `off` through near-white for `max`.

## Custom tools

`tools.ts` registers dedicated `jq`, `find`, and `rg` tools. They use the canonical tool names, so Pi selects them over same-named built-ins (notably `find`). Each tool supports cancellation and truncates large output to 2000 lines or 50KB, saving complete truncated output to a temporary file.

## Install

Load this repository as a local user-scoped pi package:

```bash
pi install ~/Documents/pi-config
```

Set `quietStartup` to `true` and `theme` to `neutral` in `~/.pi/agent/settings.json`; the extension supplies the replacement header and the package supplies the theme.

## Structure

- `extensions/ui.ts` — minimal header and footer UI
- `extensions/tools.ts` — `jq`, `find`, and `rg` tools
- `themes/neutral.json` — monochrome UI theme with a gray-to-white thinking-level ramp
- `AGENTS.md` — project instructions loaded by pi
- `package.json` — pi package manifest

> Keep credentials out of Git. Authentication files, environment files, sessions, and local dependencies are ignored.
