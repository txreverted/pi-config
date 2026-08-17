# pi-config

Private Pi package. `README.md` is the only human guide. Code and tests define behavior.

Pi loads [`package.json`](package.json). Repository agents follow [`AGENTS.md`](AGENTS.md).

![Pi config TUI](assets/pi-config.png)

## Map

| Feature | Entry source | Tests |
|---|---|---|
| Package and theme | [`package.json`](package.json), [`themes/neutral.json`](themes/neutral.json) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |
| TUI | [`extensions/ui.ts`](extensions/ui.ts) | [`test/ui-extension.test.mjs`](test/ui-extension.test.mjs), [`test/ui-render-normalization.test.mjs`](test/ui-render-normalization.test.mjs) |
| Local tools | [`extensions/tools.ts`](extensions/tools.ts) | [`test/tools-extension.test.mjs`](test/tools-extension.test.mjs) |
| Web tools | [`extensions/web.ts`](extensions/web.ts) | [`test/web-extension.test.mjs`](test/web-extension.test.mjs), [`test/live-web.mjs`](test/live-web.mjs) |
| User questions | [`extensions/ask.ts`](extensions/ask.ts) | [`test/ask-extension.test.mjs`](test/ask-extension.test.mjs) |
| Subagents and teams | [`extensions/subagents.ts`](extensions/subagents.ts), [`subagents/registry.ts`](subagents/registry.ts) | [`test/subagents-core.test.mjs`](test/subagents-core.test.mjs), [`test/subagents-security.test.mjs`](test/subagents-security.test.mjs), [`test/live-subagent.mjs`](test/live-subagent.mjs) |
| Personal todos | [`extensions/todo.ts`](extensions/todo.ts) | [`test/todo-extension.test.mjs`](test/todo-extension.test.mjs) |
| Shared tasks | [`extensions/task.ts`](extensions/task.ts) | [`test/task-extension.test.mjs`](test/task-extension.test.mjs) |
| Goal mode | [`extensions/goal.ts`](extensions/goal.ts) | [`test/goal-extension.test.mjs`](test/goal-extension.test.mjs) |
| Concise replies | [`extensions/concise.ts`](extensions/concise.ts) | [`test/concise-extension.test.mjs`](test/concise-extension.test.mjs) |
| Ponytail | [`extensions/ponytail.ts`](extensions/ponytail.ts) | [`test/ponytail-extension.test.mjs`](test/ponytail-extension.test.mjs) |

Core modules and focused tests sit beside these entry files.

## Runtime Markdown

Pi discovers commands and skills through [`package.json`](package.json). The subagent registry loads role prompts by exact role name.

| Kind | Files |
|---|---|
| Commands | [`prompts/implement-review.md`](prompts/implement-review.md), [`prompts/list-improvements.md`](prompts/list-improvements.md), [`prompts/research.md`](prompts/research.md), [`prompts/review.md`](prompts/review.md), [`prompts/rework-docs.md`](prompts/rework-docs.md) |
| Roles | [`subagents/prompts/Explore.md`](subagents/prompts/Explore.md), [`subagents/prompts/researcher.md`](subagents/prompts/researcher.md), [`subagents/prompts/reviewer.md`](subagents/prompts/reviewer.md), [`subagents/prompts/worker.md`](subagents/prompts/worker.md) |
| Skills | [`skills/ponytail/SKILL.md`](skills/ponytail/SKILL.md), [`skills/ponytail-audit/SKILL.md`](skills/ponytail-audit/SKILL.md), [`skills/ponytail-debt/SKILL.md`](skills/ponytail-debt/SKILL.md), [`skills/ponytail-help/SKILL.md`](skills/ponytail-help/SKILL.md), [`skills/ponytail-review/SKILL.md`](skills/ponytail-review/SKILL.md) |

## Use

- `/agents` manages persistent subagents. `Explore` and `reviewer` file tools stay inside their delegated workspace.
- Background `worker` launches require a trusted Git project and a clean checkout. Applying changes removes the managed worktree and prevents resume.
- `/todos` shows the branch-local personal list. `/tasks` shows the shared task list.
- `/goal <objective>` starts goal mode. Use `status`, `pause`, `resume`, `edit`, or `clear` after `/goal`.
- `/ponytail [lite|full|ultra|off|status|default <mode>]` manages Ponytail. One-shot commands use `/skill:ponytail-review`, `/skill:ponytail-audit`, `/skill:ponytail-debt`, and `/skill:ponytail-help`.

`PI_CONFIG_MAX_CONCURRENT_AGENTS` accepts `1`–`20`. `PI_CONFIG_MAX_AGENT_DEPTH` accepts `1`–`3`. `PI_CONFIG_ASK_TIMEOUT` accepts `off`, `60s`, `5m`, or `10m`. `PI_CONFIG_TASK_LIST_ID` selects a shared task list. Ponytail reads `PONYTAIL_DEFAULT_MODE`, `PONYTAIL_QUIET_STARTUP`, and `PONYTAIL_HIDE_STATUS`.

## Safety

- A `worker` runs with the local user's privileges. Separate processes isolate context, not operating-system permissions.
- Active subagents have no time, token, cost, turn, or tool-call ceiling. Goal mode can use every active tool and provider quota. Cancel work that is no longer useful.
- Never send secrets or private code through `web_search`.
- Never pass signed URLs or private query tokens to `web_fetch`. `web_fetch` fails closed when an HTTP proxy is configured.
- Keep settings, auth, keys, sessions, transcripts, task state, and managed worktrees outside this repo. See [`.gitignore`](.gitignore).

## Install

Requires Node `>=22.19.0`, Pi packages `>=0.84.2`, TypeBox `>=1.3.14`, and `jq` on `PATH`. The package activates Pi's built-in `find` and `grep` tools.

```bash
npm ci --ignore-scripts --omit=dev --legacy-peer-deps
pi install "$PWD"
```

Use `neutral` with `outputPad: 1` and `editorPaddingX: 0`. Set `tuiMode: "regular"` in Pi's global settings. Keep Pi settings outside this repo.

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

Live web checks use public external services but no model provider quota:

```bash
PI_LIVE_WEB=1 npm run test:live-web
```

Test TUI changes in an interactive terminal.
