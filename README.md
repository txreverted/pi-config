# pi-config

Private, version-controlled custom configuration for [pi](https://github.com/earendil-works/pi).

## Current UI

The `ui.ts` extension replaces the startup chrome and footer with one compact, sticky line directly above the editor:

```text
π v0.84.2 > ~/Documents/pi-config(main) · review > gpt-5.6-sol (xhigh) > 23.2%/272k > $9.077 (sub) > 27s
────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────
```

The line shows the working directory, git branch and optional session name, model and thinking level, context usage, cost, and subscription status. While Pi is responding, it also appends a live elapsed timer that resets for each response and disappears when Pi settles. On narrow terminals it preserves the complete status and wraps it onto additional rows without exceeding the terminal width. It stays docked to the editor while messages, working indicators, tool calls, and diffs render above it. Extensions and context files remain fully loaded but are not listed in the UI.

When orchestration is active, a separate compact panel below the editor lists each foreground subagent call or background workflow with live elapsed time and health. Detailed per-child timers and current-tool activity remain in the tool card and `/runs` inspector.

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

## Subagents and workflows

`orchestration.ts` registers one shared runtime: `subagents.ts` supplies focused foreground child Pi processes with fixed roles, while `workflows.ts` supplies trusted built-in workflows and a bounded declarative DAG. There is no third-party orchestration dependency and no model-generated JavaScript execution.

Every child and workflow step reports a live elapsed timer, startup phase, protocol freshness, current-tool duration, attempts, turns, tool count, usage, and metadata-only recent activity. Child reasoning effort is independent of the parent: scouts and researchers use `low`, while reviewers, workers, synthesizers, and trusted security-review steps use `high`. Unsupported reasoning models fall back to `off`; no fixed role requests `xhigh` or `max`. The UI distinguishes healthy, quiet, long-running, needs-attention, and definitively failed work. A deterministic startup watchdog retries an eligible read-only child once, while writers never retry automatically. Fixed read-only roles also have hard turn/tool/token/cost limits to prevent runaway tool loops; writers retain only their elapsed deadline because counter-based interruption is unsafe during mutation.

Focused subagents remain foreground. Workflows run by default in a detached private host, appear in a compact panel below the editor, and deliver their result exactly once to the originating session. `/runs` opens the inspector for details, output tail, stop, and safe read-only retry; `/orchestration-doctor` checks the runtime without making a provider request. Background state is atomically stored with private permissions under `~/.pi/agent/orchestration-runs` and retained for at most seven days/30 records.

Built-in `review`, `implement-review`, and `research` graphs and their prompt templates are enabled. Declarative workflows accept at most eight fixed-role DAG steps, explicit dependencies/evidence references, and one explicitly authorized writer; every writer run requires `allowWrite: true` and TUI confirmation. They support bounded sequence, parallel fan-out, pipelines, and fan-in without `eval`, VM access, imports, arbitrary expressions, nested workflows, or runtime-generated unbounded work. Read-only retry replays only the longest unchanged successful journal prefix.

Children remain separate processes with strict role-specific tools, ambient extensions and project agent discovery disabled, bounded output/time/concurrency, process-group cancellation, and aggregate usage reporting. Coding roles receive repository context plus fixed non-mutating `git_status` and `git_diff`; the public-web researcher has no local read capability. See [`docs/subagents.md`](docs/subagents.md) for the lifecycle, health thresholds, budgets, state/privacy model, DSL, and testing.

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
- `extensions/orchestration.ts` — single package entrypoint for the shared runtime and tools
- `extensions/subagents.ts` — foreground fixed-role `subagent` tool and live cards
- `extensions/subagents-core.ts` — isolated child runner, protocol/activity parsing, retry, budgets, and usage
- `extensions/subagent-tools.ts` — fixed read-only Git tools for coding children
- `extensions/orchestration-core.ts` — shared lifecycle, timer, and health model
- `extensions/orchestration-state.ts` — private atomic workflow state and retention
- `extensions/orchestration-runtime.ts` — background manager, panel, `/runs`, control, doctor, and delivery
- `extensions/workflow-host.ts` — detached static/declarative workflow host
- `extensions/workflows.ts` — background-by-default workflow tool and declarative schema
- `extensions/workflows-core.ts` — DAG validation/execution, evidence bounds, and journal replay
- `subagents/` — fixed role and built-in workflow registries plus internal prompts
- `prompts/` — enabled built-in workflow prompt templates
- `docs/subagents.md` — architecture, lifecycle, health, budgets, privacy, DSL, and usage
- `test/web-core.test.mjs` — parser, extraction, and URL-safety tests
- `test/ask-core.test.mjs` — questionnaire validation and formatting tests
- `test/subagents-*.test.mjs` — child lifecycle, retry, budget, protocol, and security tests
- `test/orchestration-*.test.mjs` — health, private state, detached host, and result-delivery tests
- `test/workflows-core.test.mjs` — static/declarative DAG, journal, and failure-propagation tests
- `test/tools-core.test.mjs` — bounded subprocess, timeout, and cancellation tests
- `test/ui-core.test.mjs` — compact UI formatting and adaptive-layout tests
- `test/config.test.mjs` — stable resource manifest and privacy-ignore tests
- `themes/neutral.json` — monochrome UI theme with a gray-to-white thinking-level ramp
- `AGENTS.md` — project instructions loaded by pi
- `package.json` — pi package manifest and deterministic development checks

For development, install dev dependencies with `npm ci --ignore-scripts`, then run `npm run check` for strict TypeScript checking, deterministic lifecycle/background-host tests, and a real Pi extension-loading smoke test. Provider-backed smoke is intentionally opt-in and tightly bounded: `PI_LIVE_ORCHESTRATION=1 npm run test:live-orchestration`; add `PI_LIVE_WORKFLOW=1` only when intentionally validating the tightly capped parallel-startup/synthesis smoke.

> Keep credentials out of Git. Authentication files, environment files, Pi-local settings, sessions, and local dependencies are ignored. This web extension does not read or store credentials.
