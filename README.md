# pi-config

Private Pi package. Code and tests define behavior.

## Map

| Feature | Source | Tests |
|---|---|---|
| Package and CI | [`package.json`](package.json), [`package-lock.json`](package-lock.json), [`tsconfig.json`](tsconfig.json), [`.gitignore`](.gitignore), [`.github/workflows/check.yml`](.github/workflows/check.yml) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |
| Repository workflows | [`prompts/`](prompts/) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |
| Writing cleanup | [`extensions/unslop.ts`](extensions/unslop.ts), [`skills/unslop/SKILL.md`](skills/unslop/SKILL.md) | [`test/unslop-extension.test.mjs`](test/unslop-extension.test.mjs), [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |
| Web search | [`extensions/web.ts`](extensions/web.ts), [`extensions/web-core.ts`](extensions/web-core.ts) | [`test/web-extension.test.mjs`](test/web-extension.test.mjs), [`test/web-core.test.mjs`](test/web-core.test.mjs), [`test/live-web.mjs`](test/live-web.mjs) |
| User questions | [`extensions/ask.ts`](extensions/ask.ts), [`extensions/ask-core.ts`](extensions/ask-core.ts), [`extensions/ask-ui.ts`](extensions/ask-ui.ts) | [`test/ask-extension.test.mjs`](test/ask-extension.test.mjs), [`test/ask-core.test.mjs`](test/ask-core.test.mjs), [`test/ask-ui.test.mjs`](test/ask-ui.test.mjs) |
| Compact layout | [`extensions/layout.ts`](extensions/layout.ts) | [`test/layout-extension.test.mjs`](test/layout-extension.test.mjs) |
| Context views | [`pi-context-view 0.4.3`](https://github.com/dimk90/pi-context-view/tree/v0.4.3), [`package.json`](package.json) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |
| Caveman output | [`extensions/concise.ts`](extensions/concise.ts) | [`test/concise-extension.test.mjs`](test/concise-extension.test.mjs) |
| Ponytail | [`extensions/ponytail.ts`](extensions/ponytail.ts) | [`test/ponytail-extension.test.mjs`](test/ponytail-extension.test.mjs) |
| Display safety | [`extensions/text-safety.ts`](extensions/text-safety.ts) | [`test/text-safety.test.mjs`](test/text-safety.test.mjs), [`test/ui-render-normalization.test.mjs`](test/ui-render-normalization.test.mjs) |

## Use

- `ask_user_question` asks one to four questions with review and revision in TUI or RPC mode. Every question offers Other.
- `/context` runs in TUI mode. It shows estimated context usage. `/context injections` shows the captured system prompt, tool definitions, skills, context files, extension prompt additions, and injected messages. The extension adds no instructions or messages to normal model context.
- Ponytail full mode instructs the model to batch edits before one final project check. It does not repeat a passing check unless later edits can affect it. This is a prompt policy, not a command blocker.
- Caveman keeps output terse without dropping requested detail.
- Unslop is always on. `/skill:unslop` explicitly invokes the same skill.
- The TUI hides the startup header. Its two-line footer shows the working directory above cost, context use, and answer time. The model stays at the lower right.
- `/r-docs [scope]` audits documentation. `/r-impl [scope]` audits implementation without code changes. `/r-git` creates branches, pushes them, opens pull requests, and merges them without local checks.
- `web_search` sends each permitted query to Exa's keyless MCP service first. It falls back to keyless Parallel MCP, then DuckDuckGo HTML. It blocks likely credentials. Code-like queries require TUI or RPC approval.
- `grep` and `find` use Pi's native tools. No background code index runs.

## Safety

- Never send secrets or private code through `web_search`.
- [`.gitignore`](.gitignore) excludes local settings, auth, keys, sessions, and transcripts.

## Install

Use Node 22.19.0 or newer. CI tests Pi 0.84.2 and the latest release.

```bash
npm ci --ignore-scripts --omit=dev --legacy-peer-deps
pi install "$PWD"
```

## Check

```bash
npm ci --ignore-scripts
npm run check
```

[`.github/workflows/check.yml`](.github/workflows/check.yml) runs on pushes, pull requests, a weekly schedule, and manual dispatch. It tests pinned and latest Pi on Ubuntu and pinned Pi on Windows.

The live web test calls external services.

```bash
PI_LIVE_WEB=1 npm run test:live-web
```

The live web job runs weekly and on manual dispatch. Failures are non-blocking provider-drift signals.

## Sources

- [Pi 0.84.2 docs](https://github.com/earendil-works/pi/tree/v0.84.2/packages/coding-agent/docs), [source](https://github.com/earendil-works/pi/tree/v0.84.2), [release](https://github.com/earendil-works/pi/releases/tag/v0.84.2), and [changelog with migrations](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/CHANGELOG.md).
- [Agent Skills specification](https://agentskills.io/specification) and [source](https://github.com/agentskills/agentskills) define [`skills/unslop/SKILL.md`](skills/unslop/SKILL.md).
- [pi-context-view 0.4.3 docs and source](https://github.com/dimk90/pi-context-view/tree/v0.4.3), [release](https://github.com/dimk90/pi-context-view/releases/tag/v0.4.3), and [changelog](https://github.com/dimk90/pi-context-view/blob/v0.4.3/CHANGELOG.md).
- [Ponytail 4.9.0 docs and source](https://github.com/DietrichGebert/ponytail/tree/v4.9.0) and its [release](https://github.com/DietrichGebert/ponytail/releases/tag/v4.9.0) cover the policy adapted by [`extensions/ponytail.ts`](extensions/ponytail.ts).
- [Node.js 22.19.0 API](https://nodejs.org/download/release/v22.19.0/docs/api/), [source](https://github.com/nodejs/node/tree/v22.19.0), [release](https://nodejs.org/en/blog/release/v22.19.0), [20 to 22 migration guide](https://nodejs.org/en/blog/migrations/v20-to-v22), and [release schedule](https://nodejs.org/en/about/previous-releases).
- [npm CLI docs](https://docs.npmjs.com/cli/), [`npm ci`](https://docs.npmjs.com/cli/commands/npm-ci/), [source](https://github.com/npm/cli), and [releases](https://github.com/npm/cli/releases).
- [TypeScript 5.9 notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html), [5.9.3 source](https://github.com/microsoft/TypeScript/tree/v5.9.3), and [5.9.3 release](https://github.com/microsoft/TypeScript/releases/tag/v5.9.3). [`@types/node` 22.20.1](https://www.npmjs.com/package/@types/node/v/22.20.1) comes from [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node).
- [`typebox` 1.3.14 docs](https://sinclairzx81.github.io/typebox/), [source](https://github.com/sinclairzx81/typebox/tree/1.3.14), [release](https://github.com/sinclairzx81/typebox/releases/tag/1.3.14), and [1.0 migration guide](https://github.com/sinclairzx81/typebox/blob/main/changelog/1.0.0-migration.md).
- [LinkeDOM 0.18.13 docs and source](https://github.com/WebReflection/linkedom/tree/v0.18.13) and [release tags](https://github.com/WebReflection/linkedom/tags).
- [Git reference](https://git-scm.com/docs), [source](https://github.com/git/git), and [release notes](https://github.com/git/git/tree/master/Documentation/RelNotes).
- [GitHub Actions docs](https://docs.github.com/en/actions), [pull request docs](https://docs.github.com/en/pull-requests), [`checkout` pinned source](https://github.com/actions/checkout/tree/9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0) and [v7.0.0 release](https://github.com/actions/checkout/releases/tag/v7.0.0), and [`setup-node` pinned source](https://github.com/actions/setup-node/tree/820762786026740c76f36085b0efc47a31fe5020) and [v7.0.0 release](https://github.com/actions/setup-node/releases/tag/v7.0.0).
- [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28), [versioning](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning), [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), [source](https://github.com/modelcontextprotocol/modelcontextprotocol), and [JSON-RPC 2.0 specification](https://www.jsonrpc.org/specification).
- [Exa MCP docs](https://exa.ai/docs/reference/exa-mcp), [server source](https://github.com/exa-labs/exa-mcp-server), and [releases](https://github.com/exa-labs/exa-mcp-server/releases).
- [Parallel Search MCP docs](https://docs.parallel.ai/integrations/mcp/search-mcp), [programmatic use](https://docs.parallel.ai/integrations/mcp/programmatic-use), and [changelog](https://docs.parallel.ai/resources/changelog).
- [DuckDuckGo non-JavaScript search help](https://duckduckgo.com/duckduckgo-help-pages/features/non-javascript) and [help source](https://github.com/duckduckgo/duckduckgo-help-pages).
