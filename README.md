# pi-config

Private Pi package. [`DESIRED_CONFIG.md`](DESIRED_CONFIG.md) defines its scope. Code and tests define behavior.

## Map

| Feature | Source | Tests |
|---|---|---|
| Package and theme | [`package.json`](package.json), [`themes/neutral.json`](themes/neutral.json) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |
| Shared UI | [`extensions/ui.ts`](extensions/ui.ts) | [`test/ui-extension.test.mjs`](test/ui-extension.test.mjs) |
| Command-line tools | [`extensions/tools.ts`](extensions/tools.ts) | [`test/tools-extension.test.mjs`](test/tools-extension.test.mjs) |
| Web search and fetch | [`extensions/web.ts`](extensions/web.ts) | [`test/web-extension.test.mjs`](test/web-extension.test.mjs) |
| Subagents | [`extensions/subagents.ts`](extensions/subagents.ts), [`subagents/registry.ts`](subagents/registry.ts) | [`test/subagents-core.test.mjs`](test/subagents-core.test.mjs), [`test/subagents-security.test.mjs`](test/subagents-security.test.mjs) |
| Todos | [`extensions/todo.ts`](extensions/todo.ts) | [`test/todo-extension.test.mjs`](test/todo-extension.test.mjs) |
| Goal mode | [`extensions/goal.ts`](extensions/goal.ts) | [`test/goal-extension.test.mjs`](test/goal-extension.test.mjs) |
| Caveman replies | [`extensions/concise.ts`](extensions/concise.ts) | [`test/concise-extension.test.mjs`](test/concise-extension.test.mjs) |
| Ponytail | [`extensions/ponytail.ts`](extensions/ponytail.ts), [`skills/ponytail/SKILL.md`](skills/ponytail/SKILL.md) | [`test/ponytail-extension.test.mjs`](test/ponytail-extension.test.mjs) |

Subagent role prompts are in [`subagents/prompts/`](subagents/prompts/).

## Use

- `todo` manages one branch-local dependency-aware list. `/todos` shows it.
- `subagent` runs independent tasks concurrently and returns every result in the same call. Use it for work that is faster in parallel, including unblocked todos.
- Read-only agents inspect the delegated workspace. Each worker uses a separate Git worktree.
- Workers require a trusted Git project, a clean parent checkout, and human confirmation. Inspect each patch. Completed worktrees remain recoverable by id from their original repository after a restart.
- `/goal <objective>` continues until completion. Use `status`, `pause`, `resume`, `edit`, or `clear`. A failed turn pauses safely. `goal_wait` waits for input or a deadline without completing the goal.
- `/ponytail` accepts `lite`, `full`, `ultra`, `off`, `status`, or `default <mode>`.
- `web_search` and `web_fetch` need no API key.
- `jq` executes the local command. Pi's built-in `grep` and `find` are active.

`PI_CONFIG_MAX_CONCURRENT_AGENTS` accepts `1` through `20`.

## Safety

- A confirmed worker runs with the local user's privileges. Process separation isolates context, not operating-system permissions. File-tool checks do not constrain Bash filesystem or network access.
- Subagents have no total time, token, cost, turn, or tool-call ceiling. They stop after prolonged inactivity or cancellation.
- Goal mode has no automatic run ceiling. It can use every active tool and provider quota until completion, waiting, user action, or a failed turn.
- Never send secrets or private code through `web_search`.
- Never pass signed URLs or private query tokens to `web_fetch`. It fails closed when an HTTP proxy is configured.
- Settings, auth, keys, sessions, transcripts, and managed worktrees stay outside this repository. See [`.gitignore`](.gitignore).

## Install

Use the Node and Pi versions in [`package.json`](package.json). Keep `jq` on `PATH`.

```bash
npm ci --ignore-scripts --omit=dev --legacy-peer-deps
pi install "$PWD"
```

Use the `neutral` theme. Keep Pi settings outside this repository.

## Check

```bash
npm ci --ignore-scripts
npm run check
```

[`.github/workflows/check.yml`](.github/workflows/check.yml) runs Linux checks. Windows runs typechecking and `npm run test:windows`.

Live checks use external services. Subagent checks spend provider quota.

```bash
PI_LIVE_WEB=1 npm run test:live-web
PI_LIVE_SUBAGENT=1 PI_PROVIDER=<provider> PI_MODEL=<model> npm run test:live-subagent
```

Test UI changes in an interactive terminal.
