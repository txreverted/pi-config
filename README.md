# pi-config

## Markdown

| Class | Path | Purpose | Tests |
|---|---|---|---|
| Human docs | `README.md` | Repository map and commands | [`test/config.test.mjs`](test/config.test.mjs) |
| Instructions | [`AGENTS.md`](AGENTS.md) | Repository rules | — |
| Runtime code | [`prompts/`](prompts/): [`r-docs.md`](prompts/r-docs.md), [`r-git.md`](prompts/r-git.md), [`r-impl.md`](prompts/r-impl.md) | `/r-docs [scope]`, `/r-git`, `/r-impl [scope]` | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |
| Runtime code | [`skills/unslop/SKILL.md`](skills/unslop/SKILL.md) | Writing policy and `/skill:unslop` | [`test/unslop-extension.test.mjs`](test/unslop-extension.test.mjs), [`test/config.test.mjs`](test/config.test.mjs) |

No tracked Markdown is frozen.

## Code

| Area | Source | Tests |
|---|---|---|
| Package and CI | [`package.json`](package.json), [`package-lock.json`](package-lock.json), [`tsconfig.json`](tsconfig.json), [`.gitignore`](.gitignore), [`.github/workflows/check.yml`](.github/workflows/check.yml) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |
| User questions | [`extensions/ask.ts`](extensions/ask.ts), [`extensions/ask-core.ts`](extensions/ask-core.ts), [`extensions/ask-ui.ts`](extensions/ask-ui.ts) | [`test/ask-extension.test.mjs`](test/ask-extension.test.mjs), [`test/ask-core.test.mjs`](test/ask-core.test.mjs), [`test/ask-ui.test.mjs`](test/ask-ui.test.mjs) |
| Web search | [`extensions/web.ts`](extensions/web.ts), [`extensions/web-core.ts`](extensions/web-core.ts) | [`test/web-extension.test.mjs`](test/web-extension.test.mjs), [`test/web-core.test.mjs`](test/web-core.test.mjs), [`test/live-web.mjs`](test/live-web.mjs) |
| TUI layout | [`extensions/layout.ts`](extensions/layout.ts) | [`test/layout-extension.test.mjs`](test/layout-extension.test.mjs) |
| Context views | [`package.json`](package.json) (`pi-context-view` 0.4.3) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |
| Output policies | [`extensions/concise.ts`](extensions/concise.ts), [`extensions/unslop.ts`](extensions/unslop.ts), [`extensions/ponytail.ts`](extensions/ponytail.ts) | [`test/concise-extension.test.mjs`](test/concise-extension.test.mjs), [`test/unslop-extension.test.mjs`](test/unslop-extension.test.mjs), [`test/ponytail-extension.test.mjs`](test/ponytail-extension.test.mjs) |
| Display safety | [`extensions/text-safety.ts`](extensions/text-safety.ts) | [`test/text-safety.test.mjs`](test/text-safety.test.mjs), [`test/ui-render-normalization.test.mjs`](test/ui-render-normalization.test.mjs) |

## Runtime

- `ask_user_question` asks one to four structured questions in TUI or RPC mode. Each question includes Other.
- `web_search` sends approved queries to Exa, then may fall back to Parallel and DuckDuckGo. Never send secrets or private code through `web_search`. Code-like queries require TUI or RPC approval.
- `/context` shows estimated context use. `/context injections` shows captured prompt, tool, skill, context-file, extension, and message injections. It adds no instructions or messages to normal model context.
- Caveman, Unslop, and Ponytail are always active. Ponytail is a prompt policy, not a command blocker.
- The TUI hides the startup header. Its two-line footer shows the working directory, cost, context use, answer time, and model.
- `grep` and `find` are Pi tools. No background code index runs.

## Install

Requires Node 22.19.0 or newer.

```bash
npm ci --ignore-scripts --omit=dev --legacy-peer-deps
pi install "$PWD"
```

## Check

```bash
npm ci --ignore-scripts
npm run check
```

The live web test calls external services.

```bash
PI_LIVE_WEB=1 npm run test:live-web
```

The live web job runs weekly and on manual dispatch. Failures are non-blocking provider-drift signals.
