# pi-config

Private Pi package. [`DESIRED_CONFIG.md`](DESIRED_CONFIG.md) defines its scope. Code and tests define behavior.

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
| Display safety | [`extensions/text-safety.ts`](extensions/text-safety.ts) | [`test/text-safety.test.mjs`](test/text-safety.test.mjs), [`test/ui-render-normalization.test.mjs`](test/ui-render-normalization.test.mjs) |

## Use

- `todo` manages one branch-local dependency-aware list with a Claude Code-like terminal UI. `/todos` shows it.
- `ask_user_question` asks one to four structured questions with review and revision in TUI or RPC mode. Every question includes Other.
- `/goal <objective>` continues while active. Use `status`, `pause`, `resume`, `edit`, or `clear`. A failed turn pauses safely. `goal_complete` and `goal_wait` must be called without sibling tools.
- `/ponytail` accepts `lite`, `full`, `ultra`, `off`, `status`, or `default <mode>`. Enabled modes appear in the footer without a startup notification.
- The TUI hides the startup header, keeps Pi's editor, and uses a responsive one-line footer.
- Caveman output stays terse while preserving technical details and requested depth.
- `/r-docs [scope]` audits documentation. `/r-impl [scope]` audits implementation without changing it. `/r-git` turns working changes into checked pull requests and merges them when repository rules allow.
- `web_search` needs no API key. It blocks likely credentials and asks before sending code-like queries.
- `jq` bounds input, time, output, concurrency, and monitored working-set memory. It retains at most 10 truncated outputs or 50MB per session. Pi's built-in `grep` and `find` are active.

## Safety

- Goal mode has no automatic run ceiling. It can use every active tool and provider quota until completion, waiting, user action, or a failed turn.
- Never send secrets or private code through `web_search`.
- Settings, auth, keys, sessions, and transcripts stay outside this repository. See [`.gitignore`](.gitignore).

## Install

Use the Node and Pi versions in [`package.json`](package.json). Keep `jq` on `PATH`.

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
```

CI runs this check weekly and on manual dispatch. Failures are non-blocking provider-drift signals.

Test UI changes in an interactive terminal.
