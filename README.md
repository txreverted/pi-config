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

## Internal subagents and workflows

`subagents.ts` adds a small, auditable foreground runtime with no third-party orchestration dependency:

- `subagent` runs one fixed-role child Pi process or a bounded parallel read-only batch.
- `workflow` runs one of three static workflows: `review`, `implement-review`, or `research`.

Children are ephemeral separate processes with strict role-specific tools, ambient extensions and trusted project config resources disabled, bounded output/time/concurrency, process-group cancellation, and aggregate usage reporting. Coding roles still receive normal repository context files such as `AGENTS.md`. The only writer is `worker`; project agent discovery, dynamic scripts, nesting, background jobs, external runners, MCP imports, and session sharing are intentionally unsupported.

Use `/review`, `/implement-review`, or `/research` for the corresponding native prompt templates. See [`docs/subagents.md`](docs/subagents.md) for roles, workflow graphs, security boundaries, and testing.

## Compaction-safe directives

`directives.ts` augments Pi's native Enter/Alt+Enter steering and follow-up queues. It records queued text in hidden session entries, observes the actual delivered message after template expansion, and reintroduces an active directive only when compaction-aware model context no longer contains it. Directives remain active through retries, compaction, and queued continuations, then retire at `agent_settled`.

The extension does not replace or replay Pi's native queue. `/directives` shows its active ledger; `/directives-clear` stops reinforcement without removing native undelivered messages. See [`docs/directives.md`](docs/directives.md).

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
- `extensions/subagents.ts` — `subagent` and static `workflow` tools
- `extensions/subagents-core.ts` — isolated child runner, protocol parsing, limits, and usage
- `extensions/workflows-core.ts` — deterministic workflow validation and execution
- `extensions/directives.ts` — compaction-safe steering/follow-up lifecycle hooks
- `extensions/directives-core.ts` — directive ledger, matching, and bounded reinjection
- `subagents/` — fixed role registry and internal prompts
- `prompts/` — native `/review`, `/implement-review`, and `/research` templates
- `docs/subagents.md` — architecture, trust boundaries, and usage
- `docs/directives.md` — queue augmentation behavior and limitations
- `test/web-core.test.mjs` — parser, extraction, and URL-safety tests
- `test/ask-core.test.mjs` — questionnaire validation and formatting tests
- `test/subagents-*.test.mjs` — child runner and security tests
- `test/workflows-core.test.mjs` — workflow validation and execution tests
- `test/directives-core.test.mjs` — ledger, compaction, and reinjection tests
- `themes/neutral.json` — monochrome UI theme with a gray-to-white thinking-level ramp
- `AGENTS.md` — project instructions loaded by pi
- `package.json` — pi package manifest

> Keep credentials out of Git. Authentication files, environment files, sessions, and local dependencies are ignored. This web extension does not read or store credentials.
