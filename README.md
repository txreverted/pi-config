# pi-config

Private Pi package. Small UI. Safer tools. Fixed read-only subagents.

This file is the one human guide. Code is the source of truth.

## Agent start here

Read in this order:

1. [`AGENTS.md`](AGENTS.md) — repo rules.
2. [`package.json`](package.json) — what Pi loads.
3. [`subagents/registry.ts`](subagents/registry.ts) — role tools, limits, prompts.
4. Relevant `extensions/*-core.ts` — behavior.
5. Relevant `test/*.test.mjs` — proof.

Before work:

```bash
git status --short
npm run check
```

Dirty tree? Keep user changes. Never reset them.

## What Pi loads

[`package.json`](package.json) loads six extensions, six skills, five prompt commands, and one theme.

| Resource | Current job |
|---|---|
| [`extensions/ui.ts`](extensions/ui.ts) | Remove stock header/footer. Add one status line above editor. |
| [`extensions/tools.ts`](extensions/tools.ts) | Add `jq`, `rg`, `find`. Replace active `grep` with `rg`. |
| [`extensions/web.ts`](extensions/web.ts) | Add keyless `web_search` and hardened `web_fetch`. |
| [`extensions/ask.ts`](extensions/ask.ts) | Add `ask_user_question` in UI modes. |
| [`extensions/subagents.ts`](extensions/subagents.ts) | Add isolated read-only reviewer and researcher children. |
| [`extensions/ponytail.ts`](extensions/ponytail.ts) | Add always-on minimal-code modes and Ponytail commands. |
| [`skills/`](skills/) | Add Ponytail mode, review, audit, debt, gain, and help skills. |
| [`prompts/`](prompts/) | Add `/review`, `/implement-review`, `/research`, `/rework-docs`, and `/list-improvements`. |
| [`themes/neutral.json`](themes/neutral.json) | Add the `neutral` theme. |

## Current behavior

### UI

One sticky line sits above the editor:

```text
π v0.84.2 > ~/Documents/pi-config(main) · review > gpt-5.6-sol (xhigh) > 23.2%/272k > $9.077 (sub) > 27s
```

It shows:

- Pi version
- cwd, Git branch, session name
- model, thinking level
- context use
- session cost and subscription marker
- live response time

Narrow terminal? Line wraps. Data stays. Subagent detail stays in its tool card.

Theme: mostly gray. Green = success. Red = error. Amber = warning. Thinking borders go dark to bright.

### Local tools

| Tool | Current behavior |
|---|---|
| `jq` | Shell-free args. Reads stdin, files, or null input. Needs `jq` on `PATH`. |
| `find` | Uses `fd`. Overrides built-in `find`. Glob search. Skips ignored files, `.git`, `node_modules` by default. |
| `rg` | Uses ripgrep. Replaces active built-in `grep`. Respects ignore files by default. |

Shared rules:

- 2 minute timeout
- process-group cancel, then kill fallback
- bounded memory
- display cap: 2,000 lines or 50 KB
- private `0600` file for truncated stdout
- search stdout hard stop: 10 MiB
- temp output removed on session shutdown
- `fd` and `rg` found in Pi agent bin or `PATH`; Pi downloader runs on first miss

Core: [`extensions/tools-core.ts`](extensions/tools-core.ts). Tests: [`test/tools-core.test.mjs`](test/tools-core.test.mjs), [`test/tools-extension.test.mjs`](test/tools-extension.test.mjs).

### Web tools

`web_search`:

- Exa keyless MCP first
- DuckDuckGo HTML fallback
- 1–10 results
- query sent to provider

`web_fetch`:

- public HTTP(S) only
- direct HTML, Markdown, text, JSON, XML
- Jina Reader fallback by policy
- no local/private network, URL credentials, browser state, or auth pages
- DNS validation and address pinning on each redirect
- 30 second timeout, 5 redirects, 5 MiB fetch cap
- paged output, 40 KiB tool cap

All web output is marked untrusted. Reader use can disclose the full URL to Jina. Never send secrets or signed URLs.

Core: [`extensions/web-core.ts`](extensions/web-core.ts). Tests: [`test/web-core.test.mjs`](test/web-core.test.mjs).

### Questions

`ask_user_question` asks 1–4 questions. Each question is free text or has 2–5 choices. Tool adds custom answer. One recommendation max. Cancel means no answer.

Tool is active in TUI/RPC. Tool is removed in print/JSON mode.

Core: [`extensions/ask-core.ts`](extensions/ask-core.ts). Tests: [`test/ask-core.test.mjs`](test/ask-core.test.mjs).

### Ponytail

Ponytail is recreated locally from the MIT-licensed behavior of [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail); this package does not import or install the upstream plugin. Full mode is active by default and injects a minimal-code decision ladder on each parent-agent turn and into delegated subagent tasks.

Commands:

- `/ponytail [lite|full|ultra|off]` changes the session mode.
- `/ponytail status` reports current and default modes.
- `/ponytail default <mode>` writes the default to the platform config path.
- `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain`, and `/ponytail-help` run the corresponding local skills.
- `stop ponytail` and `normal mode` deactivate it when used as standalone input.

Configuration resolution is environment, then `~/.config/ponytail/config.json` (XDG and Windows paths are honored), then `full`. Supported variables are `PONYTAIL_DEFAULT_MODE`, `PONYTAIL_QUIET_STARTUP`, and `PONYTAIL_HIDE_STATUS`.

Core: [`extensions/ponytail-core.ts`](extensions/ponytail-core.ts). Skills: [`skills/`](skills/). Tests: [`test/ponytail-core.test.mjs`](test/ponytail-core.test.mjs), [`test/ponytail-extension.test.mjs`](test/ponytail-extension.test.mjs).

## Subagents

`subagent` runs 1–6 foreground read-only child Pi processes, with at most 3 active at once.

| Role | Tools | Think | Deadline | Hard budget |
|---|---|---:|---:|---|
| `reviewer` | `read, grep, find, ls, git_status, git_diff` | high | 15m | 24 turns, 96 tools, 2M tokens, $2 |
| `researcher` | `web_search, web_fetch` | low | 15m | 16 turns, 32 tools, 750k tokens, $1 |

Each child starts with JSON/print mode, no session, no approval, and no ambient extensions, skills, prompt templates, or themes. The registry adds only its fixed tools and one fixed extension. Reviewer keeps repo context files; researcher gets no local context. Unsupported reasoning models use thinking `off`.

Child cwd resolves inside the parent workspace. Role and task files use private temporary paths and are removed after the run. Children inherit the parent process environment, so this is process isolation rather than an OS sandbox. Cancellation and the 30-minute timeout cap terminate the process group. Output is bounded to 16,000 characters.

All child output is untrusted model evidence. Verify important claims directly and run deterministic checks. The parent remains the only writer and synthesizer.

Source: [`extensions/subagents-core.ts`](extensions/subagents-core.ts). Security tests: [`test/subagents-security.test.mjs`](test/subagents-security.test.mjs).

## Install

Current dev pin: Pi `0.84.2`. Node: `>=22.19.0`.

Runtime needs `jq` on `PATH`. Pi can install `fd` and `rg` on first use. In `PI_OFFLINE=1`, provide those binaries first.

```bash
cd ~/Documents/pi-config
npm ci --ignore-scripts --omit=dev --legacy-peer-deps
pi install ~/Documents/pi-config
```

Set Pi user settings:

```json
{
  "quietStartup": true,
  "theme": "neutral"
}
```

Do not commit settings, auth, env files, keys, sessions, or transcripts. [`.gitignore`](.gitignore) blocks common local state.

## Develop and verify

```bash
npm ci --ignore-scripts
npm run check
```

`npm run check` runs:

1. strict TypeScript check
2. deterministic unit tests
3. provider-free Pi package smoke test

CI runs that check against both the lockfile-pinned Pi version and the latest published Pi packages. Runtime peer ranges remain open so the config can load with newer Pi releases.

Optional provider smoke:

```bash
PI_LIVE_SUBAGENT=1 PI_PROVIDER=<provider> PI_MODEL=<model> npm run test:live-subagent
```

Live smoke spends quota. UI changes also need an interactive TTY check.

## Markdown map

Tracked Markdown count: **15**.

Two guide files:

- [`AGENTS.md`](AGENTS.md) — machine-loaded repo rules. Must stay separate.
- `README.md` — this guide. All human docs live here.

Thirteen runtime prompt and skill files. These are code, not extra docs. Keep separate because Pi and the registries load them by command or role:

- Commands: [`prompts/review.md`](prompts/review.md), [`prompts/implement-review.md`](prompts/implement-review.md), [`prompts/research.md`](prompts/research.md), [`prompts/rework-docs.md`](prompts/rework-docs.md), [`prompts/list-improvements.md`](prompts/list-improvements.md)
- Roles: [`subagents/prompts/reviewer.md`](subagents/prompts/reviewer.md), [`subagents/prompts/researcher.md`](subagents/prompts/researcher.md)
- Ponytail: [`skills/ponytail/SKILL.md`](skills/ponytail/SKILL.md), [`skills/ponytail-review/SKILL.md`](skills/ponytail-review/SKILL.md), [`skills/ponytail-audit/SKILL.md`](skills/ponytail-audit/SKILL.md), [`skills/ponytail-debt/SKILL.md`](skills/ponytail-debt/SKILL.md), [`skills/ponytail-gain/SKILL.md`](skills/ponytail-gain/SKILL.md), [`skills/ponytail-help/SKILL.md`](skills/ponytail-help/SKILL.md)

No separate architecture doc. It duplicated code and drifted. Use this map, then open source and tests.
