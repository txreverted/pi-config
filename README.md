# pi-config

Private, version-controlled custom configuration for [pi](https://github.com/earendil-works/pi).

## Current UI

The `ui.ts` extension replaces the startup chrome and footer with one compact, sticky line directly above the editor:

```text
π v0.84.2 > ~/Documents/pi-config(main) · review > gpt-5.6-sol (xhigh) > 23.2%/272k > $9.077 (sub) > 27s
────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────
```

The line shows the working directory, git branch and optional session name, model and thinking level, context usage, cost, and subscription status. While Pi is responding, it also appends a live elapsed timer that resets for each response and disappears when Pi settles. On narrow terminals it progressively removes optional left-side detail before sacrificing the cost or timer. It stays docked to the editor while messages, working indicators, tool calls, and diffs render above it. Extensions and context files remain fully loaded but are not listed in the UI.

The `neutral` theme remains mostly monochrome, with subtle green, red, and amber reserved for success, error, warning, and diff semantics. Thinking-level borders brighten progressively from dark gray for `off` through near-white for `max`.

## Custom tools

`tools.ts` registers a dedicated `jq` tool. It uses shell-free argument passing, a two-minute timeout, process-group cancellation with a kill fallback, bounded in-memory output, and a private streamed temporary file for complete truncated stdout. Retained output is removed when the session shuts down. Pi's maintained built-in `find` and `grep` tools handle file discovery and content search; this package no longer overrides them.

## Web access

`web.ts` adds two keyless tools:

- `web_search` searches through Exa's zero-config MCP service, falls back to DuckDuckGo's keyless HTML endpoint, and returns titles, URLs, and snippets.
- `web_fetch` reads public HTTP(S) pages directly, converts readable HTML to Markdown, and falls back to the keyless Jina Reader when direct retrieval fails, is unsupported, or extracts no readable content. Short but readable direct pages are returned without disclosure to Jina.

The extension has no credential configuration and cannot use local files, browser cookies, authenticated pages, or private-network addresses. DNS results are validated and the direct connection is pinned to a validated public address across each redirect. Responses, redirects, time, and output size are bounded. Search queries are disclosed to Exa or the DuckDuckGo fallback; URLs handled by the reader fallback are disclosed to Jina.

Web content is always marked and prompted as untrusted. Instructions embedded in search results or pages must never be followed as agent instructions.

## Clarifying questions

`ask.ts` adds `ask_user_question`, a dependency-free interactive tool for resolving meaningful ambiguity before implementation. It can group up to four related questions, offer explained and recommended choices, accept multiline custom answers, or ask free-form questions. Pi is instructed to inspect the repository first, ask only when the answer would materially change the work, and avoid interrupting for trivial or convention-resolved decisions.

The tool uses Pi's native selection and editor dialogs in TUI and RPC clients. It is removed from the active tool set in non-interactive print and JSON modes.

## Internal subagents

`subagents.ts` adds a small, auditable foreground runtime with no third-party orchestration dependency. The `subagent` tool runs one fixed-role child Pi process or a bounded parallel read-only batch.

Children are ephemeral separate processes with strict role-specific tools, ambient extensions and trusted project config resources disabled, bounded output/time/concurrency, process-group cancellation, and aggregate usage reporting. Coding roles receive normal repository context files plus fixed non-mutating `git_status` and `git_diff` tools. The public-web researcher has no local read capability. The only writer is `worker`; project agent discovery, dynamic scripts, nesting, background jobs, external runners, MCP imports, and session sharing are intentionally unsupported.

The static workflow implementation and prompt templates remain in source for repair, but are not loaded by the package and no `workflow` tool is exposed. See [`docs/subagents.md`](docs/subagents.md) for roles, security boundaries, dormant workflow graphs, and testing.

## Sources

The extensions and workflows in this repository were informed by these Pi resources and packages:

- [Official Pi documentation](https://pi.dev/docs/latest)
- [`@juicesharp/rpiv-ask-user-question`](https://pi.dev/packages/@juicesharp/rpiv-ask-user-question?name=ask)
- [`pi-subagents`](https://pi.dev/packages/pi-subagents)
- [`@quintinshaw/pi-dynamic-workflows`](https://pi.dev/packages/@quintinshaw/pi-dynamic-workflows)
- [`pi-web-access`](https://pi.dev/packages/pi-web-access)

## Install

The package is tested against Pi 0.84.2 and requires Node 22.19 or newer plus `jq` on `PATH`. Install the pinned HTML extraction dependencies, then load this repository as a local user-scoped pi package:

```bash
cd ~/Documents/pi-config
npm ci --ignore-scripts --omit=dev --legacy-peer-deps
pi install ~/Documents/pi-config
```

Set `quietStartup` to `true` and `theme` to `neutral` in `~/.pi/agent/settings.json`; the extension supplies the replacement header and the package supplies the theme.

## Structure

- `extensions/ui.ts` — minimal header and footer UI
- `extensions/tools.ts` — bounded `jq` tool
- `extensions/tools-core.ts` — streamed subprocess capture, timeout, and cancellation
- `extensions/web.ts` — minimal `web_search` and `web_fetch` Pi tools
- `extensions/web-core.ts` — keyless providers, extraction, limits, and SSRF protections
- `extensions/ask.ts` — interactive `ask_user_question` tool
- `extensions/ask-core.ts` — questionnaire validation and answer formatting
- `extensions/subagents.ts` — stable `subagent` tool
- `extensions/subagents-core.ts` — isolated child runner, protocol parsing, limits, and usage
- `extensions/subagent-tools.ts` — fixed read-only Git tools for coding children
- `extensions/workflows.ts` — dormant, explicitly loadable workflow adapter
- `extensions/workflows-core.ts` — dormant deterministic workflow validation and execution
- `subagents/` — fixed role registry and internal prompts
- `prompts/` — dormant workflow templates retained but not loaded
- `docs/subagents.md` — architecture, trust boundaries, and usage
- `test/web-core.test.mjs` — parser, extraction, and URL-safety tests
- `test/ask-core.test.mjs` — questionnaire validation and formatting tests
- `test/subagents-*.test.mjs` — child runner and security tests
- `test/workflows-core.test.mjs` — dormant workflow validation and execution tests
- `test/tools-core.test.mjs` — bounded subprocess, timeout, and cancellation tests
- `test/ui-core.test.mjs` — compact UI formatting and adaptive-layout tests
- `test/config.test.mjs` — stable resource manifest and privacy-ignore tests
- `themes/neutral.json` — monochrome UI theme with a gray-to-white thinking-level ramp
- `AGENTS.md` — project instructions loaded by pi
- `package.json` — pi package manifest and deterministic development checks

For development, install dev dependencies with `npm ci --ignore-scripts`, then run `npm run check` for strict TypeScript checking, unit tests, and a real Pi extension-loading smoke test.

> Keep credentials out of Git. Authentication files, environment files, Pi-local settings, sessions, and local dependencies are ignored. This web extension does not read or store credentials.
