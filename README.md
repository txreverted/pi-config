# pi-config

This private Pi package adds structured questions, three repository workflows, and fixed Ponytail and Unslop policies. Pi still owns models, sessions, and built-in tools. Follow [AGENTS.md](https://github.com/txreverted/pi-config/blob/main/AGENTS.md) when changing the repository.

## Use

Requires Node 22.19.0 or newer.

```bash
npm ci --ignore-scripts
npm run check
npx --no-install pi -e "$PWD"
```

The check type-checks, tests, packs the exact production files, installs the tarball without development dependencies, and loads its resources through isolated offline Pi state. It makes no model calls. Installation and auditing may contact the registry.

## Runtime

- [`ask_user_question`](extensions/ask.ts) asks one to four questions through Pi's TUI or RPC dialogs. Each has two to four choices, supports one or multiple selections, and adds `Other`. Custom answers are sanitized and capped at 2,000 UTF-8 bytes and 400 lines; truncation is reported. Its metadata estimate is at most 400 tokens.
- [`Ponytail`](extensions/ponytail.ts) and [`Unslop`](extensions/unslop.ts) modify every per-turn system prompt in that order. Caveman-style compression retains their operational rules. Their combined Pi estimate is at most 2,000 tokens.
- [`/r-docs [scope]`](prompts/r-docs.md) rebuilds human documentation from code. Invocation permits replacing dirty in-scope docs without confirmation. It prepares replacements before overwriting or deleting files.
- [`/r-git`](prompts/r-git.md) splits all dirty work into checked pull requests, pushes them, waits for required gates, and merges green PRs without confirmation.
- [`/r-impl [scope]`](prompts/r-impl.md) audits core behavior and implementation size without editing files unless asked. The three default prompt expansions combine to at most 775 tokens.

## Change and verify

- [`package.json`](package.json) selects the extensions and prompt directory.
- [`extensions/ask-core.ts`](extensions/ask-core.ts) owns question validation and state. [`extensions/ask.ts`](extensions/ask.ts) owns the Pi dialogs.
- [`policies/unslop.md`](policies/unslop.md) holds the Unslop writing rules.
- [Tests](https://github.com/txreverted/pi-config/tree/main/test) cover resources, prompts, policies, dialogs, packaging, and Pi loading. [CI](https://github.com/txreverted/pi-config/blob/main/.github/workflows/check.yml) checks the minimum pinned stack, the latest stack, and pinned Windows support.

Run only the canonical check after code or prompt changes. Restart Pi after source changes. Stop Pi with `/quit` or Ctrl+C twice.

## Safety and state

Pi packages run with full user access. Policies guide the model; they do not control filesystem, shell, network, Git, or provider access. `/r-git` changes remote repositories, and model prompts may incur provider charges.

Pi owns authentication and JSONL sessions. The repository [ignores](https://github.com/txreverted/pi-config/blob/main/.gitignore) credentials, settings, Pi state, sessions, and transcripts. Treat session files as private.

The package is private, has no package `dependencies` or package-wide license, and is not published by CI.

## Attribution

Policy text adapts pinned MIT sources: [Ponytail](https://github.com/DietrichGebert/ponytail/blob/2ed6c52c9d7e5e56942508591085fd45dea277d3/skills/ponytail/SKILL.md), [Unslop](https://github.com/cursor/plugins/blob/99559f2f52047978602ef365589275831e76af07/pstack/skills/unslop/SKILL.md), and [Caveman](https://github.com/JuliusBrussee/caveman/blob/2f49f0e1a352aa810e70056b7930aeb0b3d219b4/src/rules/caveman-activate.md). Their retained notices are [`ponytail.LICENSE`](policies/ponytail.LICENSE), [`unslop.LICENSE`](policies/unslop.LICENSE), and [`caveman.LICENSE`](policies/caveman.LICENSE).
