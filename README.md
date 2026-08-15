# pi-config

Private Pi package. Small UI. Safer tools. Fixed subagents. Bounded workflows.

This file is the one human guide. Code is the source of truth.

## Agent start here

Read in this order:

1. [`AGENTS.md`](AGENTS.md) — repo rules.
2. [`package.json`](package.json) — what Pi loads.
3. [`subagents/registry.ts`](subagents/registry.ts) — role tools, limits, prompts.
4. [`subagents/workflows-registry.ts`](subagents/workflows-registry.ts) — built-in graphs.
5. Relevant `extensions/*-core.ts` — behavior.
6. Relevant `test/*.test.mjs` — proof.

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
| [`extensions/orchestration.ts`](extensions/orchestration.ts) | Add `subagent`, `workflow`, run control, `/runs`, doctor. |
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

Narrow terminal? Line wraps. Data stays. No orchestration panel appears below input. Run detail stays in tool cards and `/runs`.

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

Ponytail is recreated locally from the MIT-licensed behavior of [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail); this package does not import or install the upstream plugin. Full mode is active by default and injects a minimal-code decision ladder on each parent-agent turn and into delegated subagent/workflow objectives.

Commands:

- `/ponytail [lite|full|ultra|off]` changes the session mode.
- `/ponytail status` reports current and default modes.
- `/ponytail default <mode>` writes the default to the platform config path.
- `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain`, and `/ponytail-help` run the corresponding local skills.
- `stop ponytail` and `normal mode` deactivate it when used as standalone input.

Configuration resolution is environment, then `~/.config/ponytail/config.json` (XDG and Windows paths are honored), then `full`. Supported variables are `PONYTAIL_DEFAULT_MODE`, `PONYTAIL_QUIET_STARTUP`, and `PONYTAIL_HIDE_STATUS`.

Core: [`extensions/ponytail-core.ts`](extensions/ponytail-core.ts). Skills: [`skills/`](skills/). Tests: [`test/ponytail-core.test.mjs`](test/ponytail-core.test.mjs), [`test/ponytail-extension.test.mjs`](test/ponytail-extension.test.mjs).

## Subagents

`subagent` runs foreground child Pi processes.

Limits:

- 1–6 tasks per call
- max 3 read-only children at once
- `worker` runs alone
- cwd must resolve inside parent workspace
- child output cap: 16,000 chars
- role timeout cap: 30 minutes
- one retry for eligible read-only startup/transient failure
- no writer retry

### Fixed roles

| Role | Tools | Think | Deadline | Hard budget |
|---|---|---:|---:|---|
| `scout` | `read, grep, find, ls, git_status, git_diff` | low | 8m | 16 turns, 48 tools, 750k tokens, $1 |
| `reviewer` | same read-only repo tools | high | 15m | 24 turns, 72 tools, 1.5M tokens, $1.50 |
| `worker` | `read, bash, edit, write` | high | 25m | no counter budget |
| `researcher` | `web_search, web_fetch` | low | 15m | 16 turns, 32 tools, 750k tokens, $1 |
| `synthesizer` | read-only repo tools | high | 15m | 16 turns, 48 tools, 1M tokens, $1.50 |

Unsupported reasoning model? Think level becomes `off`. Parent think level does not flow into child.

### Child boundary

Each child starts with JSON/print mode, no session, no approval, no ambient extensions, no skills, no prompt templates, and no themes. Registry adds only fixed tools and at most one fixed extension.

Coding roles keep repo context files. Researcher gets no local context. No child has `subagent`, `workflow`, or `orchestration_control`.

Role and task files use private temp paths. They leave after the run. This is process isolation, not an OS sandbox. `worker` still has user OS rights and inherits the parent process environment.

Source: [`extensions/subagents-core.ts`](extensions/subagents-core.ts). Security tests: [`test/subagents-security.test.mjs`](test/subagents-security.test.mjs).

## Workflows

`workflow` runs a built-in graph or a declarative v1 DAG. Background is default.

| Name | Graph | Writes? |
|---|---|---:|
| `review` | scout → correctness review + security review → synthesis | No |
| `implement-review` | scout → one worker → correctness review + security review → synthesis | Yes |
| `research` | two web researchers → synthesis | No |

Writer gates:

- user must authorize checkout changes
- tool input must set `allowWrite: true`
- one writer max
- UI mode asks for confirmation
- declarative writer is blocked without UI
- writer workflow never auto-retries

Declarative v1 rules:

- 1–8 fixed-role steps
- plain data only
- known fields only
- valid IDs, dependencies, output step, acyclic graph
- `include` can use only a listed dependency
- one writer max
- max evidence: 24,000 chars total, 8,000 per source
- no JS, eval, imports, expressions, nested workflows, or runtime fan-out

Ready readers run together. Ready writer runs alone. `stop` failure stops graph. `continue` failure can end as `completed_with_warnings`. Final output comes only from a successful output step.

Non-clean terminal read-only workflows can retry. Retry reuses only the unchanged successful journal prefix. Hash covers engine, role, task, objective, paths, and evidence.

Source: [`extensions/workflows-core.ts`](extensions/workflows-core.ts). Graphs: [`subagents/workflows-registry.ts`](subagents/workflows-registry.ts). Tests: [`test/workflows-core.test.mjs`](test/workflows-core.test.mjs).

## Run state and health

Health labels:

| Signal | Result |
|---|---|
| no spawn ack in 5s | attempt fails |
| no Pi protocol event in 20s | startup fails |
| no activity in 30s | `quiet` |
| no activity in 2m | `long-running` |
| no activity in 5m | `needs attention` |
| unexpected process loss, nonzero exit, or deadline | terminal failure |

Silence does not kill work.

Background state lives at `~/.pi/agent/orchestration-runs/<run-id>/`. Directories are `0700`. JSON is `0600` and atomic. State can contain source-derived text. Retention: 7 days and newest 30 records.

`/runs` and `orchestration_control` can list, inspect, stop, and safely retry. `/orchestration-doctor` checks runtime without provider use. Completion goes once to the source session. Background child usage is shown in run output, not added to parent footer cost.

Source: [`extensions/orchestration-runtime.ts`](extensions/orchestration-runtime.ts), [`extensions/orchestration-state.ts`](extensions/orchestration-state.ts), [`extensions/workflow-host.ts`](extensions/workflow-host.ts).

All child output is untrusted model output. Agent agreement is not proof. Check code. Run tests.

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

Optional provider smoke:

```bash
PI_LIVE_ORCHESTRATION=1 npm run test:live-orchestration
PI_LIVE_ORCHESTRATION=1 PI_LIVE_WORKFLOW=1 npm run test:live-orchestration
```

Live smoke spends quota. UI changes also need an interactive TTY check.

## Markdown map

Tracked Markdown count: **18**.

Two guide files:

- [`AGENTS.md`](AGENTS.md) — machine-loaded repo rules. Must stay separate.
- `README.md` — this guide. All human docs live here.

Sixteen runtime prompt and skill files. These are code, not extra docs. Keep separate because Pi and the registries load them by command or role:

- Commands: [`prompts/review.md`](prompts/review.md), [`prompts/implement-review.md`](prompts/implement-review.md), [`prompts/research.md`](prompts/research.md), [`prompts/rework-docs.md`](prompts/rework-docs.md), [`prompts/list-improvements.md`](prompts/list-improvements.md)
- Roles: [`subagents/prompts/scout.md`](subagents/prompts/scout.md), [`subagents/prompts/reviewer.md`](subagents/prompts/reviewer.md), [`subagents/prompts/worker.md`](subagents/prompts/worker.md), [`subagents/prompts/researcher.md`](subagents/prompts/researcher.md), [`subagents/prompts/synthesizer.md`](subagents/prompts/synthesizer.md)
- Ponytail: [`skills/ponytail/SKILL.md`](skills/ponytail/SKILL.md), [`skills/ponytail-review/SKILL.md`](skills/ponytail-review/SKILL.md), [`skills/ponytail-audit/SKILL.md`](skills/ponytail-audit/SKILL.md), [`skills/ponytail-debt/SKILL.md`](skills/ponytail-debt/SKILL.md), [`skills/ponytail-gain/SKILL.md`](skills/ponytail-gain/SKILL.md), [`skills/ponytail-help/SKILL.md`](skills/ponytail-help/SKILL.md)

No separate architecture doc. It duplicated code and drifted. Use this map, then open source and tests.
