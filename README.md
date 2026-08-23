# pi-config

This private Pi package adds structured questions, adaptive parallel research, three repository workflows, and fixed Ponytail, Unslop, and Caveman policies. Pi still owns models, sessions, and built-in tools. Follow [AGENTS.md](https://github.com/txreverted/pi-config/blob/main/AGENTS.md) when changing the repository.

## Use

Requires Node 22.19.0 or newer.

```bash
npm ci --ignore-scripts
npm run check
npx --no-install pi -e "$PWD"
```

The check type-checks, tests, dry-packs, production-installs, and loads the package through isolated offline Pi state. It makes no model calls. Package tests isolate their Pi state and npm cache; installation and auditing may contact the registry.

## Runtime

- [`ask_user_question`](extensions/ask.ts) asks one to four questions in TUI or RPC mode. Each has two to four choices plus `Other`. Custom answers are sanitized and capped at 2,000 UTF-8 bytes and 400 lines; truncation is reported.
- [`/r-fast <task>`](extensions/subagents.ts) enables one adaptive speed run. It delegates two to ten natural read-only investigations only when parallel work should beat direct work, with at most four scouts active. Scout thinking targets `survey` low, `trace` medium, and `audit` high without exceeding the parent. The parent alone decides, edits, tests, synthesizes, and uses Git.
- [`/fast`](extensions/fast.ts) toggles OpenAI provider fast mode for the current session branch. Run it once to enable fast mode and again to disable it. While active on a supported model, `fast` appears beside the model and thinking level in the footer. The priority tier applies to the main agent and `/r-fast` scouts. Unsupported models keep their normal provider requests. Fast mode uses higher provider pricing.
- [`Ponytail`](extensions/ponytail.ts), [`Unslop`](extensions/unslop.ts), and [`Caveman`](extensions/caveman.ts) modify every per-turn system prompt in that order. Their combined Pi estimate is at most 500 tokens.
- [`/r-docs [scope]`](prompts/r-docs.md) rebuilds human documentation from code. Invocation permits replacing dirty in-scope docs without confirmation. It prepares replacements before overwriting or deleting files.
- [`/r-git`](prompts/r-git.md) splits all dirty work into checked pull requests, pushes them, waits for required gates, and merges green PRs without confirmation.
- [`/r-impl [scope]`](prompts/r-impl.md) audits core behavior and implementation size without editing files unless asked.

## Change and verify

- [`package.json`](package.json) selects the extensions and prompt directory.
- [`extensions/ask-core.ts`](extensions/ask-core.ts) owns validation and state. [`extensions/ask-ui.ts`](extensions/ask-ui.ts) owns the TUI.
- [`policies/unslop.md`](policies/unslop.md) holds the Unslop writing rules.
- [Tests](https://github.com/txreverted/pi-config/tree/main/test) cover resources, prompts, policies, UI, packaging, and smoke loading. [CI](https://github.com/txreverted/pi-config/blob/main/.github/workflows/check.yml) checks pinned and latest Pi on Ubuntu plus pinned Pi on Windows.

Run only the canonical check after code or prompt changes. Restart Pi after source changes. Stop Pi with `/quit` or Ctrl+C twice.

## Safety and state

Pi packages run with full user access. Policies guide the model; they do not control filesystem, shell, network, Git, or provider access. `/r-fast` can make up to ten additional provider runs in four concurrent slots. Its scouts expose only guarded repository read/search tools, but they are not an OS sandbox. Do not use scouts for credentials, private keys, settings, sessions, or transcripts. `/r-git` changes remote repositories, and model prompts may incur provider charges.

The opt-in `npm run bench:subagents:live` benchmark uses generated fixtures and reports wall time, overlap, usage, and cost. It requires explicit environment gates, makes paid model calls, and is never part of `npm run check` or CI. It defaults to four scouts and four-way concurrency. `PI_LIVE_CONCURRENCY=2..4` selects the candidate concurrency. `PI_LIVE_COMPARE=1` adds an equivalent serial run and reports speedup, doubling the provider work. Speed still depends on task shape and provider capacity.

Pi owns authentication and JSONL sessions. The repository [ignores](https://github.com/txreverted/pi-config/blob/main/.gitignore) credentials, settings, Pi state, sessions, and transcripts. Treat session files as private.

The package is private, has no package `dependencies` or package-wide license, and is not published by CI.

## Attribution

Policy text adapts pinned MIT sources: [Ponytail](https://github.com/DietrichGebert/ponytail/blob/2ed6c52c9d7e5e56942508591085fd45dea277d3/skills/ponytail/SKILL.md), [Unslop](https://github.com/cursor/plugins/blob/99559f2f52047978602ef365589275831e76af07/pstack/skills/unslop/SKILL.md), and [Caveman](https://github.com/JuliusBrussee/caveman/blob/2f49f0e1a352aa810e70056b7930aeb0b3d219b4/src/rules/caveman-activate.md). Their notices are [`ponytail.LICENSE`](policies/ponytail.LICENSE), [`unslop.LICENSE`](policies/unslop.LICENSE), and [`caveman.LICENSE`](policies/caveman.LICENSE). This package does not include the Caveman proxy or Engine.
