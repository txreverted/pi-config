# pi-config

Pi loads this private package as TypeScript extensions and Markdown prompt templates. It adds `ask_user_question`, three `/r-*` workflows, and fixed Ponytail, Unslop, and Caveman policies. Follow [`AGENTS.md`](AGENTS.md) when changing the repository.

## Current state

| Item | Current value |
|---|---|
| Package | [`@txreverted/pi-config` 0.3.0](package.json), private |
| Runtime | [Node 22.19.0 or newer](package.json) |
| Resources | [Four extensions and three prompts](package.json); no skills or themes |
| Dependencies | No runtime dependencies |
| Pi checks | [Pinned Pi 0.84.2 and latest Pi on Ubuntu; pinned Pi on Windows](.github/workflows/check.yml) |
| Policy size | [At most 2,600 estimated tokens](test/caveman-extension.test.mjs), using Pi's estimator |

## Flow

```text
Pi startup -> package.json -> extensions + prompts
user prompt -> Ponytail -> Unslop -> Caveman -> model
model tool call -> ask_user_question -> TUI or RPC -> answer text
/r-* command -> prompt template -> user prompt
```

- [`package.json`](package.json) selects resources and policy order. Pi owns loading, sessions, models, and built-in tools. See Pi's [package](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/packages.md) and [prompt template](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/prompt-templates.md) contracts.
- [`extensions/ask.ts`](extensions/ask.ts) registers the tool and handles RPC. [`extensions/ask-core.ts`](extensions/ask-core.ts) validates state. [`extensions/ask-ui.ts`](extensions/ask-ui.ts) renders the TUI.

## Code

| Area | Source | Tests |
|---|---|---|
| Package and prompts | [`package.json`](package.json), [`prompts/`](prompts/) | [`test/config.test.mjs`](test/config.test.mjs), [`test/smoke.mjs`](test/smoke.mjs) |
| Structured questions | [`extensions/ask.ts`](extensions/ask.ts), [`extensions/ask-core.ts`](extensions/ask-core.ts), [`extensions/ask-ui.ts`](extensions/ask-ui.ts) | [`test/ask-core.test.mjs`](test/ask-core.test.mjs), [`test/ask-extension.test.mjs`](test/ask-extension.test.mjs), [`test/ask-ui.test.mjs`](test/ask-ui.test.mjs) |
| Fixed policies | [`extensions/ponytail.ts`](extensions/ponytail.ts), [`extensions/unslop.ts`](extensions/unslop.ts), [`extensions/caveman.ts`](extensions/caveman.ts) | [`test/ponytail-extension.test.mjs`](test/ponytail-extension.test.mjs), [`test/unslop-extension.test.mjs`](test/unslop-extension.test.mjs), [`test/caveman-extension.test.mjs`](test/caveman-extension.test.mjs) |

## Setup and checks

Install the lockfile with Node 22.19.0 or newer:

```bash
npm ci --ignore-scripts
```

Run the canonical check:

```bash
npm run check
```

It type-checks extensions, runs `test/*.test.mjs`, dry-packs and production-installs the package, then loads its resources through Pi with startup networking disabled. It makes no model calls. Installation and the production-install test may contact npm and update its cache. No coverage report or threshold exists. The check does not deploy, migrate, push, or publish.

## Run

```bash
npx --no-install pi -e "$PWD"
```

Stop with `/quit` or Ctrl+C twice. Restart after source changes. If package startup fails, quit and start Pi without `-e "$PWD"`. Model prompts may incur provider charges.

## Runtime state and constraints

- `ask_user_question` works in TUI and RPC mode. It accepts one to four questions with two to four options, adds `Other`, sanitizes display text, and discards partial answers on cancellation.
- Ponytail, Unslop, and Caveman modify every per-turn system prompt in that order. Ponytail is a prompt policy, not a command blocker. None of the policies controls filesystem, network, or shell access.
- Pi owns authentication and JSONL sessions. [`.gitignore`](.gitignore) excludes credentials, settings, `.pi/`, session directories, and transcripts. Treat session files as private.
- Pi packages run with full user access. [`extensions/text-safety.ts`](extensions/text-safety.ts) strips terminal and directional controls from package tool output. It does not sandbox Pi.
- The package is private, has no runtime dependencies or package-wide license, and the workflow does not publish it.
- Policy text adapts pinned MIT sources: [Ponytail](https://github.com/DietrichGebert/ponytail/blob/2ed6c52c9d7e5e56942508591085fd45dea277d3/skills/ponytail/SKILL.md), [Caveman](https://github.com/JuliusBrussee/caveman/blob/2f49f0e1a352aa810e70056b7930aeb0b3d219b4/src/rules/caveman-activate.md), and [Unslop](https://github.com/cursor/plugins/blob/99559f2f52047978602ef365589275831e76af07/pstack/skills/unslop/SKILL.md). The copied Unslop checklist retains its [MIT notice](policies/unslop.LICENSE). This package does not include the Caveman proxy or Engine.

## Related docs

### Repository work

- [`AGENTS.md`](AGENTS.md) defines repository rules.

### Runtime workflows

- [`prompts/r-docs.md`](prompts/r-docs.md) rebuilds minimal documentation with `/r-docs [scope]`.
- [`prompts/r-git.md`](prompts/r-git.md) splits dirty work into pull requests with `/r-git`.
- [`prompts/r-impl.md`](prompts/r-impl.md) audits core behavior and implementation size with `/r-impl [scope]`.

### Runtime policy

- [`policies/unslop.md`](policies/unslop.md) defines the Unslop writing checklist.
