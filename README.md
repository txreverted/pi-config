# pi-config

Pi loads this private package's manifest, TypeScript extensions, and Markdown prompt templates. The package adds two tools, an off-by-default OpenAI Fast mode, a compact TUI layout, three fixed per-turn policies, and `/r-*` workflow prompts. On request, the bundled `/context` command shows estimated context use and captured injections, while `web_search` can send an approved query to public providers. Repository work must follow [`AGENTS.md`](AGENTS.md).

## Current state

| Item | Current value |
|---|---|
| Package | [`@txreverted/pi-config` 0.3.0](package.json), marked `private` |
| Runtime floor | [Node 22.19.0 or newer](package.json) |
| Manifest resources | [Seven local extension entry points, bundled `pi-context-view` 0.4.3, and three prompt templates](package.json); no skills |
| Runtime dependencies | [Bundled `pi-context-view` 0.4.3](package-lock.json) |
| Pi validation scope | [Pi packages pinned at 0.84.2 for development](package.json); [CI also checks the latest Pi packages on Ubuntu and the pinned set on Windows](.github/workflows/check.yml) |
| Fixed policy limit | [Ponytail, Unslop, and Caveman compose once in that order with a 2,600-token test ceiling](test/caveman-extension.test.mjs); the ceiling uses Pi's estimator, not a provider tokenizer |

## Flow

```text
Pi startup
  -> package.json
  -> extension entry points + prompts/*.md
user prompt
  -> Ponytail -> Unslop -> Caveman -> model
model tool call
  -> ask_user_question -> TUI or RPC -> bounded answer text
  -> web_search -> secret/code guard -> Exa -> Parallel -> DuckDuckGo -> bounded results
/fast or --fast
  -> supported OpenAI request -> service_tier: priority
/context
  -> pi-context-view -> estimated usage or captured injections -> TUI
```

- [`package.json`](package.json) owns resource selection and policy order. Pi owns package loading, prompt expansion, session lifecycle, model access, and built-in tools. See Pi's [package](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/packages.md) and [prompt template](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/prompt-templates.md) contracts.
- [`extensions/ask.ts`](extensions/ask.ts) and [`extensions/web.ts`](extensions/web.ts) own Pi-facing schemas, guards, and rendering. Their core and UI modules contain reusable logic.
- [`extensions/fast.ts`](extensions/fast.ts) owns OpenAI Fast mode state and request selection. [`extensions/layout.ts`](extensions/layout.ts) owns TUI-only session display state.
- `pi-context-view` owns `/context` and remains a bundled dependency. Public search providers are outside this repository. No background code index runs.

## Code

| Area | Source | Tests |
|---|---|---|
| Package loading and prompts | [`package.json`](package.json), [`prompts/`](prompts/) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |
| Structured questions | [`extensions/ask.ts`](extensions/ask.ts), [`extensions/ask-core.ts`](extensions/ask-core.ts), [`extensions/ask-ui.ts`](extensions/ask-ui.ts) | [`test/ask-core.test.mjs`](test/ask-core.test.mjs), [`test/ask-extension.test.mjs`](test/ask-extension.test.mjs), [`test/ask-ui.test.mjs`](test/ask-ui.test.mjs) |
| Keyless web search | [`extensions/web.ts`](extensions/web.ts), [`extensions/web-core.ts`](extensions/web-core.ts), [`extensions/text-safety.ts`](extensions/text-safety.ts) | [`test/web-core.test.mjs`](test/web-core.test.mjs), [`test/web-extension.test.mjs`](test/web-extension.test.mjs), [`test/text-safety.test.mjs`](test/text-safety.test.mjs) |
| OpenAI Fast mode | [`extensions/fast.ts`](extensions/fast.ts) | [`test/fast-extension.test.mjs`](test/fast-extension.test.mjs) |
| TUI layout | [`extensions/layout.ts`](extensions/layout.ts), [`extensions/text-safety.ts`](extensions/text-safety.ts) | [`test/layout-extension.test.mjs`](test/layout-extension.test.mjs), [`test/ui-render-normalization.test.mjs`](test/ui-render-normalization.test.mjs) |
| Fixed policies | [`extensions/ponytail.ts`](extensions/ponytail.ts), [`extensions/unslop.ts`](extensions/unslop.ts), [`extensions/caveman.ts`](extensions/caveman.ts), [`policies/unslop.md`](policies/unslop.md) | [`test/ponytail-extension.test.mjs`](test/ponytail-extension.test.mjs), [`test/unslop-extension.test.mjs`](test/unslop-extension.test.mjs), [`test/caveman-extension.test.mjs`](test/caveman-extension.test.mjs) |
| Context inspection | [`package.json`](package.json), [`pi-context-view` v0.4.3](https://github.com/dimk90/pi-context-view/tree/v0.4.3/src) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |

## Setup and checks

Node 22.19.0 or newer and npm are required. Install the lockfile exactly:

```bash
npm ci --ignore-scripts
```

This replaces `node_modules/`. The canonical local check is:

```bash
npm run check
```

It type-checks `extensions/**/*.ts`, runs `test/*.test.mjs`, then loads all manifest resources and the complete package through Pi with startup networking disabled. The tests also dry-pack the package and install its production tarball in a temporary directory. They remove temporary files, but npm may read or update its cache and may contact the registry if required packages are absent. The check produces no coverage report and enforces no coverage threshold.

The canonical check makes no model or search-provider calls. It does not run `npm audit`, deploy, migrate, push, or publish. On pushes and pull requests, CI runs `npm audit --omit=dev` for pinned Pi jobs before the same check.

The live web test is separate and sends queries to external services:

```bash
PI_LIVE_WEB=1 npm run test:live-web
```

The script sends `Example Domain IANA` through `web_search` and directly to Parallel. These providers are keyless, but the traffic is external. The live web job runs weekly and on manual dispatch. Failures are non-blocking provider-drift signals.

## Run

After setup, load the package for one Pi process without changing Pi settings:

```bash
npx --no-install pi -e "$PWD"
```

Stop with `/quit` or Ctrl+C twice. Restart the command after source changes. If startup fails, quit and start Pi without `-e "$PWD"`.

For a persistent local install, run:

```bash
npx --no-install pi install "$PWD"
npx --no-install pi
```

This writes the local package path to Pi's user settings. Remove it with `npx --no-install pi remove "$PWD"`. Model prompts call the selected Pi provider and may incur charges.

## Runtime state and constraints

- `ask_user_question` works in TUI and RPC mode. It accepts one to four questions with two to four options each, adds `Other`, sanitizes display text, and returns no partial answers after cancellation.
- `web_search` sends every approved query to Exa first, then may use Parallel and DuckDuckGo. Never send secrets or private code through `web_search`. Its secret detector is pattern-based, code-like text needs TUI or RPC approval, and results are untrusted. Queries are capped at 500 characters and 10 results. The provider chain has a 30-second timeout, each response is capped at 2MB, and model-visible output is capped at 50KB. The tool does not fetch linked pages.
- OpenAI Fast mode starts off. Use `/fast`, `/fast on`, `/fast off`, or `/fast status`; pass `--fast` to enable it at startup. Each `session_start` resets the in-memory mode to the `--fast` flag. It sends `service_tier: "priority"` only for allowlisted `openai` and `openai-codex` models in [`extensions/fast.ts`](extensions/fast.ts). The footer shows `model (thinking) fast`, or `model fast` without a thinking level. This marker means the extension will request priority, not that OpenAI accepted the tier. Fast mode has higher API pricing or ChatGPT credit use. The layout does not reprice Pi's recorded session cost. See OpenAI's [API](https://developers.openai.com/api/docs/guides/fast-mode) and [Codex](https://developers.openai.com/codex/speed) documentation.
- [`extensions/layout.ts`](extensions/layout.ts) runs only in TUI mode. It hides the startup header and renders a two-line footer with working directory, branch, session cost, context use, answer time, status, and model. It reads Pi settings and watches them for compaction changes; it does not write them.
- `/context` requires TUI mode. Its usage figures are estimates. Before the first real turn, `pi-context-view` may create and filter one silent synthetic turn; it persists only probe role and timestamp identities. It adds no instructions or messages to normal model context. Context previews can contain prompts, context files, and session messages.
- Pi owns model authentication and JSONL sessions. [`.gitignore`](.gitignore) excludes credentials, settings, `.pi/`, session directories, and transcripts. Treat `/context` previews and Pi session files as private.
- Pi packages execute with the user's full system access. Review this checkout before loading it. [`extensions/text-safety.ts`](extensions/text-safety.ts) strips terminal and directional controls from package tool output, but this package does not sandbox Pi or gate its other tools.
- Ponytail, Unslop, and Caveman are always active. Ponytail is a prompt policy, not a command blocker. Their text cannot enforce filesystem, network, or shell restrictions.
- Policy text adapts MIT sources at pinned revisions: [Ponytail](https://github.com/DietrichGebert/ponytail/blob/2ed6c52c9d7e5e56942508591085fd45dea277d3/skills/ponytail/SKILL.md), [Caveman](https://github.com/JuliusBrussee/caveman/blob/2f49f0e1a352aa810e70056b7930aeb0b3d219b4/src/rules/caveman-activate.md), and pstack's [Unslop](https://github.com/cursor/plugins/blob/99559f2f52047978602ef365589275831e76af07/pstack/skills/unslop/SKILL.md). The copied Unslop checklist carries its [MIT notice](policies/unslop.LICENSE). This package uses the writing rules only. It does not include the Caveman proxy or Engine.
- The root package declares no package-wide license. The lockfile records bundled `pi-context-view` as MIT. The manifest is private, and [the only workflow](.github/workflows/check.yml) checks the code without publishing a release.

## Related docs

### Repository work

- [`AGENTS.md`](AGENTS.md) defines required repository, verification, and Markdown rules.

### Workflow prompts

- [`prompts/r-docs.md`](prompts/r-docs.md) powers `/r-docs [scope]` for scoped documentation work.
- [`prompts/r-git.md`](prompts/r-git.md) powers `/r-git` for grouping and merging dirty work.
- [`prompts/r-impl.md`](prompts/r-impl.md) powers `/r-impl [scope]` for evidence-based implementation audits.

### Policy maintenance

- [`policies/unslop.md`](policies/unslop.md) is the full prose checklist loaded by [`extensions/unslop.ts`](extensions/unslop.ts) before every agent run.
