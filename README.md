# pi-config

Private Pi package. Code and tests define behavior.

## Map

| Feature | Source | Tests |
|---|---|---|
| Package and CI | [`package.json`](package.json), [`package-lock.json`](package-lock.json), [`tsconfig.json`](tsconfig.json), [`.gitignore`](.gitignore), [`.github/workflows/check.yml`](.github/workflows/check.yml) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs), [`test/windows-portability.mjs`](test/windows-portability.mjs) |
| Repository workflows | [`prompts/`](prompts/) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |
| Writing cleanup | [`extensions/unslop.ts`](extensions/unslop.ts), [`skills/unslop/SKILL.md`](skills/unslop/SKILL.md) | [`test/unslop-extension.test.mjs`](test/unslop-extension.test.mjs), [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |
| Command-line tools | [`extensions/tools.ts`](extensions/tools.ts), [`extensions/tools-core.ts`](extensions/tools-core.ts) | [`test/tools-extension.test.mjs`](test/tools-extension.test.mjs), [`test/tools-core.test.mjs`](test/tools-core.test.mjs) |
| Fast file search | [`extensions/fff.ts`](extensions/fff.ts), [`package.json`](package.json) | [`test/fff-extension.test.mjs`](test/fff-extension.test.mjs), [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |
| Web search | [`extensions/web.ts`](extensions/web.ts), [`extensions/web-core.ts`](extensions/web-core.ts) | [`test/web-extension.test.mjs`](test/web-extension.test.mjs), [`test/web-core.test.mjs`](test/web-core.test.mjs), [`test/live-web.mjs`](test/live-web.mjs) |
| User questions | [`extensions/ask.ts`](extensions/ask.ts), [`extensions/ask-core.ts`](extensions/ask-core.ts), [`extensions/ask-ui.ts`](extensions/ask-ui.ts) | [`test/ask-extension.test.mjs`](test/ask-extension.test.mjs), [`test/ask-core.test.mjs`](test/ask-core.test.mjs), [`test/ask-ui.test.mjs`](test/ask-ui.test.mjs) |
| Todos | [`extensions/todo.ts`](extensions/todo.ts), [`extensions/todo-core.ts`](extensions/todo-core.ts) | [`test/todo-extension.test.mjs`](test/todo-extension.test.mjs), [`test/todo-core.test.mjs`](test/todo-core.test.mjs) |
| Goal mode | [`extensions/goal.ts`](extensions/goal.ts), [`extensions/goal-core.ts`](extensions/goal-core.ts) | [`test/goal-extension.test.mjs`](test/goal-extension.test.mjs), [`test/goal-core.test.mjs`](test/goal-core.test.mjs) |
| Compact layout | [`extensions/layout.ts`](extensions/layout.ts) | [`test/layout-extension.test.mjs`](test/layout-extension.test.mjs) |
| Context usage | [`extensions/context.ts`](extensions/context.ts), [`extensions/context-core.ts`](extensions/context-core.ts) | [`test/context-extension.test.mjs`](test/context-extension.test.mjs) |
| Caveman output | [`extensions/concise.ts`](extensions/concise.ts) | [`test/concise-extension.test.mjs`](test/concise-extension.test.mjs) |
| Ponytail | [`extensions/ponytail.ts`](extensions/ponytail.ts) | [`test/ponytail-extension.test.mjs`](test/ponytail-extension.test.mjs) |
| Parallel agents | [`extensions/subagents/`](extensions/subagents/), [`extensions/coordination-core.ts`](extensions/coordination-core.ts) | [`test/subagents-core.test.mjs`](test/subagents-core.test.mjs), [`test/subagents-extension.test.mjs`](test/subagents-extension.test.mjs), [`test/subagents-orchestration.test.mjs`](test/subagents-orchestration.test.mjs), [`test/subagents-process.test.mjs`](test/subagents-process.test.mjs), [`test/subagents-ui.test.mjs`](test/subagents-ui.test.mjs), [`test/subagents-worktree.test.mjs`](test/subagents-worktree.test.mjs), [`test/live-subagent.mjs`](test/live-subagent.mjs) |
| Display safety | [`extensions/text-safety.ts`](extensions/text-safety.ts) | [`test/text-safety.test.mjs`](test/text-safety.test.mjs), [`test/ui-render-normalization.test.mjs`](test/ui-render-normalization.test.mjs) |

## Use

- `todo` manages one branch-local list of at most 25 tasks. `/todos` shows it. Successful delegated tasks stay active until the parent verifies them.
- `parallel_agents` runs two to six independent tasks, with up to three running at once. Workers edit isolated Git worktrees without shell tools. Inspect each patch with `agent_patch` before applying its exact hash. `/agents` lists retained patches.
- `ask_user_question` asks one to four questions with review and revision in TUI or RPC mode. Every question offers Other.
- `/context` shows an estimated TUI breakdown of prompts, rules, skills, active tools, messages, output, and compacted data. It adds nothing to model context.
- By default, FFF overrides Pi's built-in `grep` and `find`. It also backs `@` file completion. Use `/fff-health` and `/fff-rescan`. Set `PI_FFF_MODE=tools-and-ui` or `PI_FFF_MODE=tools-only` before startup for prefixed tools. Switching between override and either prefixed mode with `/fff-mode` needs `/reload` to change tool names.
- `/goal <objective>` continues while active. Use `/goal status`, `/goal pause`, `/goal resume`, `/goal edit <objective>`, or `/goal clear`. Failed and restored active goals pause. `goal_complete` and `goal_wait` must run without sibling tools.
- Parent turns use always-on Ponytail full mode, Caveman, and Unslop. Child agents use the same Ponytail policy and Caveman. Caveman keeps output terse without dropping requested detail. `/skill:unslop` loads the writing skill.
- The TUI hides the startup header and uses a responsive one-line footer.
- `/r-docs [scope]` audits documentation. `/r-impl [scope]` audits implementation without code changes. `/r-git` creates, pushes, and merges pull requests without local checks.
- `web_search` sends each permitted query to Exa's keyless MCP service first. It may fall back to DuckDuckGo HTML. It blocks likely credentials. Code-like queries require TUI or RPC approval.
- `jq` runs sequentially with bounded direct input and arguments, a two-minute timeout, a 10MB combined output cap, and a best-effort 256MB working-set monitor. File contents are not pre-bounded. It retains at most 10 truncated outputs or 50MB per session.

## Safety

- Goal mode and started subagents have no token or runtime ceiling. They can use provider quota until completion, waiting, user cancellation, process/provider failure, or an output safety limit. Parallel waves multiply that usage.
- Child summaries and worker patches are untrusted. Workers require a trusted clean Git checkout. Patch application rejects files outside each worker's write scope. Worktrees isolate edits, not the child model process or provider access.
- Never send secrets or private code through `web_search`.
- [`.gitignore`](.gitignore) excludes local settings, auth, keys, sessions, and transcripts.

## Install

Use Node 22.19.0 or newer and Pi. Install `jq` on `PATH` for the `jq` tool. Worker agents require Git. The development lock pins Pi 0.84.2. CI also tests the latest Pi release.

```bash
npm ci --ignore-scripts --omit=dev --legacy-peer-deps
pi install "$PWD"
```

## Check

```bash
npm ci --ignore-scripts
npm run check
```

[`.github/workflows/check.yml`](.github/workflows/check.yml) runs `npm run check` against pinned and latest Pi on Ubuntu. Windows runs the pinned version plus `npm run test:windows`.

Live checks use external services.

```bash
PI_LIVE_WEB=1 npm run test:live-web
PI_LIVE_SUBAGENT=1 PI_PROVIDER=<provider> PI_MODEL=<model> npm run test:live-subagent
```

The workflow runs the full matrix weekly and on manual dispatch. Web failures are non-blocking provider-drift signals. The subagent check is local only because it spends configured provider quota.

Test UI changes in an interactive terminal.

## Sources

- [Pi 0.84.2 docs](https://github.com/earendil-works/pi/tree/v0.84.2/packages/coding-agent/docs), [source](https://github.com/earendil-works/pi/tree/v0.84.2), [release](https://github.com/earendil-works/pi/releases/tag/v0.84.2), and [changelog with migrations](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/CHANGELOG.md).
- [FFF 0.10.5 `pi-fff` docs and source](https://github.com/dmtrKovalenko/fff/tree/v0.10.5/packages/pi-fff) and [release](https://github.com/dmtrKovalenko/fff/releases/tag/v0.10.5).
- The local context and Ponytail implementations reference [pi-context-view 0.4.3 source](https://github.com/dimk90/pi-context-view/tree/v0.4.3) and [release](https://github.com/dimk90/pi-context-view/releases/tag/v0.4.3), plus [Ponytail 4.9.0 source](https://github.com/DietrichGebert/ponytail/tree/v4.9.0) and [release](https://github.com/DietrichGebert/ponytail/releases/tag/v4.9.0). These are not runtime dependencies.
- [Node.js 22.19.0 API](https://nodejs.org/download/release/v22.19.0/docs/api/), [source](https://github.com/nodejs/node/tree/v22.19.0), [release](https://nodejs.org/en/blog/release/v22.19.0), [20 to 22 migration guide](https://nodejs.org/en/blog/migrations/v20-to-v22), and [release schedule](https://nodejs.org/en/about/previous-releases).
- [npm CLI docs](https://docs.npmjs.com/cli/), [`npm ci`](https://docs.npmjs.com/cli/commands/npm-ci/), [source](https://github.com/npm/cli), and [releases](https://github.com/npm/cli/releases).
- [TypeScript 5.9 notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html), [5.9.3 source](https://github.com/microsoft/TypeScript/tree/v5.9.3), and [5.9.3 release](https://github.com/microsoft/TypeScript/releases/tag/v5.9.3). [`@types/node` 22.20.1](https://www.npmjs.com/package/@types/node/v/22.20.1) comes from [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node).
- [`typebox` 1.3.14 docs](https://sinclairzx81.github.io/typebox/), [source](https://github.com/sinclairzx81/typebox/tree/1.3.14), [release](https://github.com/sinclairzx81/typebox/releases/tag/1.3.14), and [1.0 migration guide](https://github.com/sinclairzx81/typebox/blob/main/changelog/1.0.0-migration.md). Bundled [`@sinclair/typebox` 0.34.52 source](https://github.com/sinclairzx81/sinclair-typebox/tree/0.34.52) and [release](https://github.com/sinclairzx81/sinclair-typebox/releases/tag/0.34.52) cover FFF's legacy peer.
- [LinkeDOM docs and source](https://github.com/WebReflection/linkedom) and [release tags](https://github.com/WebReflection/linkedom/tags).
- [jq manual](https://jqlang.org/manual/), [source](https://github.com/jqlang/jq), and [releases](https://github.com/jqlang/jq/releases).
- [Git reference](https://git-scm.com/docs), [`git worktree`](https://git-scm.com/docs/git-worktree), [source](https://github.com/git/git), and [release notes](https://github.com/git/git/tree/master/Documentation/RelNotes).
- [POSIX `ps`](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/ps.html), [Windows PowerShell 5.1](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-5.1), [`Get-Process`](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/get-process?view=powershell-5.1), and [`taskkill`](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill) document process monitoring and cancellation.
- [GitHub Actions docs](https://docs.github.com/en/actions), [pull request docs](https://docs.github.com/en/pull-requests), [`checkout` pinned source](https://github.com/actions/checkout/tree/9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0) and [v7.0.0 release](https://github.com/actions/checkout/releases/tag/v7.0.0), and [`setup-node` pinned source](https://github.com/actions/setup-node/tree/820762786026740c76f36085b0efc47a31fe5020) and [v7.0.0 release](https://github.com/actions/setup-node/releases/tag/v7.0.0).
- [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28), [versioning](https://modelcontextprotocol.io/docs/learn/versioning), [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), [source](https://github.com/modelcontextprotocol/modelcontextprotocol), and [JSON-RPC 2.0 specification](https://www.jsonrpc.org/specification).
- [Exa MCP docs](https://docs.exa.ai/mcp), [server source](https://github.com/exa-labs/exa-mcp-server), and [releases](https://github.com/exa-labs/exa-mcp-server/releases). [DuckDuckGo non-JavaScript search help](https://duckduckgo.com/duckduckgo-help-pages/features/non-javascript) covers the fallback service.
