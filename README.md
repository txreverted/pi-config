# pi-config

Private Pi package. Code and tests define behavior.

## Map

| Feature | Source | Tests |
|---|---|---|
| Package and CI | [`package.json`](package.json), [`.github/workflows/check.yml`](.github/workflows/check.yml) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs), [`test/windows-portability.mjs`](test/windows-portability.mjs) |
| Repository workflows | [`prompts/`](prompts/) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |
| Command-line tools | [`extensions/tools.ts`](extensions/tools.ts), [`extensions/tools-core.ts`](extensions/tools-core.ts) | [`test/tools-extension.test.mjs`](test/tools-extension.test.mjs), [`test/tools-core.test.mjs`](test/tools-core.test.mjs) |
| Web search | [`extensions/web.ts`](extensions/web.ts), [`extensions/web-core.ts`](extensions/web-core.ts) | [`test/web-extension.test.mjs`](test/web-extension.test.mjs), [`test/web-core.test.mjs`](test/web-core.test.mjs), [`test/live-web.mjs`](test/live-web.mjs) |
| User questions | [`extensions/ask.ts`](extensions/ask.ts), [`extensions/ask-core.ts`](extensions/ask-core.ts), [`extensions/ask-ui.ts`](extensions/ask-ui.ts) | [`test/ask-extension.test.mjs`](test/ask-extension.test.mjs), [`test/ask-core.test.mjs`](test/ask-core.test.mjs), [`test/ask-ui.test.mjs`](test/ask-ui.test.mjs) |
| Todos | [`extensions/todo.ts`](extensions/todo.ts), [`extensions/todo-core.ts`](extensions/todo-core.ts) | [`test/todo-extension.test.mjs`](test/todo-extension.test.mjs), [`test/todo-core.test.mjs`](test/todo-core.test.mjs) |
| Goal mode | [`extensions/goal.ts`](extensions/goal.ts), [`extensions/goal-core.ts`](extensions/goal-core.ts) | [`test/goal-extension.test.mjs`](test/goal-extension.test.mjs), [`test/goal-core.test.mjs`](test/goal-core.test.mjs) |
| Compact layout | [`extensions/layout.ts`](extensions/layout.ts) | [`test/layout-extension.test.mjs`](test/layout-extension.test.mjs) |
| Caveman output | [`extensions/concise.ts`](extensions/concise.ts) | [`test/concise-extension.test.mjs`](test/concise-extension.test.mjs) |
| Ponytail | [`extensions/ponytail.ts`](extensions/ponytail.ts), [`extensions/ponytail-core.ts`](extensions/ponytail-core.ts), [`skills/ponytail/SKILL.md`](skills/ponytail/SKILL.md) | [`test/ponytail-extension.test.mjs`](test/ponytail-extension.test.mjs), [`test/ponytail-core.test.mjs`](test/ponytail-core.test.mjs) |
| Parallel agents | [`extensions/subagents/`](extensions/subagents/), [`extensions/coordination-core.ts`](extensions/coordination-core.ts) | [`test/subagents-core.test.mjs`](test/subagents-core.test.mjs), [`test/subagents-extension.test.mjs`](test/subagents-extension.test.mjs), [`test/subagents-orchestration.test.mjs`](test/subagents-orchestration.test.mjs), [`test/subagents-process.test.mjs`](test/subagents-process.test.mjs), [`test/subagents-ui.test.mjs`](test/subagents-ui.test.mjs), [`test/subagents-worktree.test.mjs`](test/subagents-worktree.test.mjs), [`test/live-subagent.mjs`](test/live-subagent.mjs) |
| Display safety | [`extensions/text-safety.ts`](extensions/text-safety.ts) | [`test/text-safety.test.mjs`](test/text-safety.test.mjs), [`test/ui-render-normalization.test.mjs`](test/ui-render-normalization.test.mjs) |

## Use

- `todo` manages one branch-local dependency-aware list. `/todos` shows it. One parent task and multiple delegated tasks may run together.
- `parallel_agents` runs bounded independent explorer, worker, or reviewer tasks. [Limits and validation](extensions/subagents/core.ts) are enforced at runtime. Workers edit isolated Git worktrees without shell tools. Inspect patches with `agent_patch`; applying one requires the hash returned by inspection. `/agents` lists retained patches.
- `ask_user_question` asks one to four structured questions with review and revision in TUI or RPC mode. Every question offers Other.
- `/goal <objective>` continues while active. Use `/goal status`, `/goal pause`, `/goal resume`, `/goal edit <objective>`, or `/goal clear`. A failed turn pauses safely. `goal_complete` and `goal_wait` must be called without sibling tools.
- `/ponytail` accepts `lite`, `full`, `ultra`, `off`, `status`, or `default <mode>`. It has no passive status UI.
- The TUI hides the startup header, keeps Pi's editor, and uses a responsive one-line footer.
- Caveman output stays terse while preserving technical details and requested depth.
- `/r-docs [scope]` audits documentation. `/r-impl [scope]` audits implementation without changing it. `/r-git` turns working changes into checked pull requests and merges them when repository rules allow.
- `web_search` needs no API key. It blocks likely credentials. Code-like queries require TUI or RPC approval.
- `jq` runs sequentially with bounded input, time, and output, plus a best-effort 256MB working-set monitor. It retains at most 10 truncated outputs or 50MB per session. Pi's built-in `grep` and `find` are active.

## Safety

- Goal mode has no automatic run ceiling. It can use every active tool and provider quota until completion, waiting, user action, or a failed turn. Parallel agent waves can multiply that usage.
- Child summaries and worker patches are untrusted. Workers require a trusted clean Git checkout. Worktrees isolate edits, not the child model process or provider access.
- Never send secrets or private code through `web_search`.
- [`.gitignore`](.gitignore) excludes local settings, auth, keys, sessions, and transcripts.

## Install

Requires Node 22.19.0 or newer, Pi 0.84.2 or newer, and `jq` on `PATH`.

```bash
npm ci --ignore-scripts --omit=dev --legacy-peer-deps
pi install "$PWD"
```

## Check

```bash
npm ci --ignore-scripts
npm run check
```

[`.github/workflows/check.yml`](.github/workflows/check.yml) runs `npm run check` on Ubuntu and Windows. Windows also runs `npm run test:windows`.

Live checks use external services.

```bash
PI_LIVE_WEB=1 npm run test:live-web
PI_LIVE_SUBAGENT=1 PI_PROVIDER=<provider> PI_MODEL=<model> npm run test:live-subagent
```

CI runs the web check weekly and on manual dispatch. Its failures are non-blocking provider-drift signals. The subagent smoke is manual because it spends configured provider quota.

Test UI changes in an interactive terminal.
