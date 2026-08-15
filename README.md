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

## Web access

`web.ts` adds two keyless tools:

- `web_search` searches through Exa's zero-config MCP service, falls back to DuckDuckGo's keyless HTML endpoint, and returns titles, URLs, and snippets.
- `web_fetch` reads public HTTP(S) pages directly, converts readable HTML to Markdown, and falls back to the keyless Jina Reader for blocked, JavaScript-heavy, PDF, or unsupported pages.

The extension has no credential configuration and cannot use local files, browser cookies, authenticated pages, or private-network addresses. DNS results are validated and the direct connection is pinned to a validated public address across each redirect. Responses, redirects, time, and output size are bounded. Search queries are disclosed to Exa or the DuckDuckGo fallback; URLs handled by the reader fallback are disclosed to Jina.

Web content is always marked and prompted as untrusted. Instructions embedded in search results or pages must never be followed as agent instructions.

## Clarifying questions

`ask.ts` adds `ask_user_question`, a dependency-free interactive tool for resolving meaningful ambiguity before implementation. It can group up to four related questions, offer explained and recommended choices, accept multiline custom answers, or ask free-form questions. Pi is instructed to inspect the repository first, ask only when the answer would materially change the work, and avoid interrupting for trivial or convention-resolved decisions.

The tool uses Pi's native selection and editor dialogs in TUI and RPC clients. It is removed from the active tool set in non-interactive print and JSON modes.

## Install

Install the pinned HTML extraction dependencies, then load this repository as a local user-scoped pi package:

```bash
cd ~/Documents/pi-config
npm ci --ignore-scripts --legacy-peer-deps
pi install ~/Documents/pi-config
```

Set `quietStartup` to `true` and `theme` to `neutral` in `~/.pi/agent/settings.json`; the extension supplies the replacement header and the package supplies the theme.

## Structure

- `extensions/ui.ts` — minimal header and footer UI
- `extensions/tools.ts` — `jq`, `find`, and `rg` tools
- `extensions/web.ts` — minimal `web_search` and `web_fetch` Pi tools
- `extensions/web-core.ts` — keyless providers, extraction, limits, and SSRF protections
- `extensions/ask.ts` — interactive `ask_user_question` tool
- `extensions/ask-core.ts` — questionnaire validation and answer formatting
- `test/web-core.test.mjs` — parser, extraction, and URL-safety tests
- `test/ask-core.test.mjs` — questionnaire validation and formatting tests
- `themes/neutral.json` — monochrome UI theme with a gray-to-white thinking-level ramp
- `AGENTS.md` — project instructions loaded by pi
- `package.json` — pi package manifest

> Keep credentials out of Git. Authentication files, environment files, sessions, and local dependencies are ignored. This web extension does not read or store credentials.
