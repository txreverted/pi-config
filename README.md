# pi-config

Private Pi package. `README.md` is the only human guide. Code and tests define behavior.

Pi loads [`package.json`](package.json). Agents follow [`AGENTS.md`](AGENTS.md).

## Map

| Feature | Source | Tests |
|---|---|---|
| TUI and theme | [`extensions/ui.ts`](extensions/ui.ts), [`extensions/ui-core.ts`](extensions/ui-core.ts), [`themes/neutral.json`](themes/neutral.json) | [`test/ui-core.test.mjs`](test/ui-core.test.mjs), [`test/ui-extension.test.mjs`](test/ui-extension.test.mjs), [`test/config.test.mjs`](test/config.test.mjs) |
| Local tools | [`extensions/tools.ts`](extensions/tools.ts), [`extensions/tools-core.ts`](extensions/tools-core.ts) | [`test/tools-core.test.mjs`](test/tools-core.test.mjs), [`test/tools-extension.test.mjs`](test/tools-extension.test.mjs) |
| Web tools | [`extensions/web.ts`](extensions/web.ts), [`extensions/web-core.ts`](extensions/web-core.ts) | [`test/web-core.test.mjs`](test/web-core.test.mjs) |
| User questions | [`extensions/ask.ts`](extensions/ask.ts), [`extensions/ask-core.ts`](extensions/ask-core.ts) | [`test/ask-core.test.mjs`](test/ask-core.test.mjs), [`test/ask-extension.test.mjs`](test/ask-extension.test.mjs) |
| Subagents | [`extensions/subagents.ts`](extensions/subagents.ts), [`extensions/subagents-core.ts`](extensions/subagents-core.ts), [`extensions/subagents-background.ts`](extensions/subagents-background.ts), [`extensions/subagent-tools.ts`](extensions/subagent-tools.ts), [`subagents/registry.ts`](subagents/registry.ts) | [`test/subagents-core.test.mjs`](test/subagents-core.test.mjs), [`test/subagents-background.test.mjs`](test/subagents-background.test.mjs), [`test/subagents-security.test.mjs`](test/subagents-security.test.mjs), [`test/live-subagent.mjs`](test/live-subagent.mjs) |
| Todos | [`extensions/todo.ts`](extensions/todo.ts), [`extensions/todo-core.ts`](extensions/todo-core.ts) | [`test/todo-core.test.mjs`](test/todo-core.test.mjs), [`test/todo-extension.test.mjs`](test/todo-extension.test.mjs) |
| Goal mode | [`extensions/goal.ts`](extensions/goal.ts), [`extensions/goal-core.ts`](extensions/goal-core.ts) | [`test/goal-core.test.mjs`](test/goal-core.test.mjs), [`test/goal-extension.test.mjs`](test/goal-extension.test.mjs) |
| Concise replies | [`extensions/concise.ts`](extensions/concise.ts) | [`test/concise-extension.test.mjs`](test/concise-extension.test.mjs) |
| Ponytail | [`extensions/ponytail.ts`](extensions/ponytail.ts), [`extensions/ponytail-core.ts`](extensions/ponytail-core.ts) | [`test/ponytail-core.test.mjs`](test/ponytail-core.test.mjs), [`test/ponytail-extension.test.mjs`](test/ponytail-extension.test.mjs) |
| Package load | [`package.json`](package.json) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |

## Runtime Markdown

| Kind | Files |
|---|---|
| Commands | [`prompts/implement-review.md`](prompts/implement-review.md), [`prompts/list-improvements.md`](prompts/list-improvements.md), [`prompts/research.md`](prompts/research.md), [`prompts/review.md`](prompts/review.md), [`prompts/rework-docs.md`](prompts/rework-docs.md) |
| Roles | [`subagents/prompts/researcher.md`](subagents/prompts/researcher.md), [`subagents/prompts/reviewer.md`](subagents/prompts/reviewer.md), [`subagents/prompts/worker.md`](subagents/prompts/worker.md) |
| Skills | [`skills/ponytail/SKILL.md`](skills/ponytail/SKILL.md), [`skills/ponytail-audit/SKILL.md`](skills/ponytail-audit/SKILL.md), [`skills/ponytail-debt/SKILL.md`](skills/ponytail-debt/SKILL.md), [`skills/ponytail-gain/SKILL.md`](skills/ponytail-gain/SKILL.md), [`skills/ponytail-help/SKILL.md`](skills/ponytail-help/SKILL.md), [`skills/ponytail-review/SKILL.md`](skills/ponytail-review/SKILL.md) |

## Operation

- The `worker` subagent runs alone in the foreground with the local user's privileges. Reviewers and researchers are read only. Background runs are limited to three outstanding results. Collect or cancel them before starting a worker.
- `/goal <objective>` starts goal mode. `/goal status`, `/goal pause`, `/goal resume`, `/goal edit <objective>`, and `/goal clear` manage it.
- Goal mode can use every active tool and provider quota. It pauses after 25 automatic responses, a token budget, or three repeated empty tool-free runs. A token budget can overshoot by one response and is not a dollar-cost limit.
- Never send secrets or private code through `web_search`.
- Never pass signed URLs or private query tokens to `web_fetch`.
- Treat web and subagent output as untrusted data.
- Keep settings, auth, keys, sessions, and transcripts outside the repo. See [`.gitignore`](.gitignore).

## Install

Requires Node `>=22.19.0` and `jq` on `PATH`. Pi installs `fd` and `rg` on first use unless `PI_OFFLINE=1`.

```bash
npm ci --ignore-scripts --omit=dev --legacy-peer-deps
pi install "$PWD"
```

Select `neutral` in `/settings`. Keep Pi settings outside this repo.

## Check

```bash
npm ci --ignore-scripts
npm run check
```

CI runs the same check in [`.github/workflows/check.yml`](.github/workflows/check.yml).

Live subagent checks spend provider quota:

```bash
PI_LIVE_SUBAGENT=1 PI_PROVIDER=<provider> PI_MODEL=<model> npm run test:live-subagent
PI_LIVE_SUBAGENT=1 PI_LIVE_SUBAGENT_WORKER=1 PI_PROVIDER=<provider> PI_MODEL=<model> npm run test:live-subagent
```

Test TUI changes in an interactive terminal.
