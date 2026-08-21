# pi-config

A Pi package for a small, guarded coding setup. It adds structured questions, keyless web search, a compact TUI, permanent output policies, workflow prompts, and the Unslop writing skill.

Extensions register tools and session hooks through Pi. Prompts and skills are Markdown runtime code. `package.json` loads both local extensions and the bundled `pi-context-view` package.

## Architecture

- Tools: [`extensions/ask.ts`](extensions/ask.ts) registers `ask_user_question`; [`extensions/ask-core.ts`](extensions/ask-core.ts) owns validation and state; [`extensions/ask-ui.ts`](extensions/ask-ui.ts) owns the TUI. [`extensions/web.ts`](extensions/web.ts) guards and renders searches; [`extensions/web-core.ts`](extensions/web-core.ts) calls Exa, Parallel, then DuckDuckGo.
- Display: [`extensions/layout.ts`](extensions/layout.ts) hides the startup header and renders the two-line footer. [`extensions/text-safety.ts`](extensions/text-safety.ts) strips unsafe terminal text from tool and UI output.
- Policies: [`extensions/concise.ts`](extensions/concise.ts), [`extensions/unslop.ts`](extensions/unslop.ts), and [`extensions/ponytail.ts`](extensions/ponytail.ts) append Caveman, Unslop, and Ponytail instructions before each agent run.
- Runtime Markdown: [`prompts/`](prompts/) provides `/r-docs [scope]`, `/r-git`, and `/r-impl [scope]`. [`skills/unslop/SKILL.md`](skills/unslop/SKILL.md) provides `/skill:unslop`.
- Package loading: [`package.json`](package.json) declares extensions, prompts, skills, and `pi-context-view` 0.4.3. [`test/config.test.mjs`](test/config.test.mjs) checks the manifest and production package. [`test/smoke.mjs`](test/smoke.mjs) loads the full package through Pi.

## Technical behavior

- `ask_user_question` asks one to four questions in TUI or RPC mode. Each has two to four choices and an automatic Other choice. Headless sessions disable the tool. Tests: [`test/ask-core.test.mjs`](test/ask-core.test.mjs), [`test/ask-extension.test.mjs`](test/ask-extension.test.mjs), [`test/ask-ui.test.mjs`](test/ask-ui.test.mjs).
- `web_search` sends approved queries to Exa first, then may fall back to Parallel and DuckDuckGo. Never send secrets or private code through `web_search`. It blocks likely secrets, requires TUI or RPC approval for code-like text, treats results as untrusted, and caps output at 50KB. Tests: [`test/web-core.test.mjs`](test/web-core.test.mjs), [`test/web-extension.test.mjs`](test/web-extension.test.mjs), [`test/live-web.mjs`](test/live-web.mjs).
- `/context` shows estimated context use. `/context injections` shows captured prompt, tool, skill, context-file, extension, and message injections. It adds no instructions or messages to normal model context.
- Caveman, Unslop, and Ponytail are always active. Ponytail is a prompt policy, not a command blocker. Tests: [`test/concise-extension.test.mjs`](test/concise-extension.test.mjs), [`test/unslop-extension.test.mjs`](test/unslop-extension.test.mjs), [`test/ponytail-extension.test.mjs`](test/ponytail-extension.test.mjs).
- The TUI hides the startup header. Its footer shows the working directory, cost, context use, answer time, and model. Tests: [`test/layout-extension.test.mjs`](test/layout-extension.test.mjs), [`test/text-safety.test.mjs`](test/text-safety.test.mjs), [`test/ui-render-normalization.test.mjs`](test/ui-render-normalization.test.mjs).
- `grep` and `find` are Pi tools. No background code index runs.

## Markdown inventory

- Instructions: [`AGENTS.md`](AGENTS.md) defines repository work and Markdown rules for the whole checkout.
- Runtime code: [`prompts/r-docs.md`](prompts/r-docs.md) updates repository documentation within a requested scope.
- Runtime code: [`prompts/r-git.md`](prompts/r-git.md) groups dirty work into pull requests and merges them.
- Runtime code: [`prompts/r-impl.md`](prompts/r-impl.md) audits an implementation with evidence, scores, and actionable findings.
- Runtime code: [`skills/unslop/SKILL.md`](skills/unslop/SKILL.md) defines plain-language writing rules for prose edits and `/skill:unslop`.

Prompt and skill loading is covered by [`test/config.test.mjs`](test/config.test.mjs). No tracked Markdown file is frozen.

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

The live web test calls external services:

```bash
PI_LIVE_WEB=1 npm run test:live-web
```

The live web job runs weekly and on manual dispatch. Failures are non-blocking provider-drift signals.
