# pi-config

This private Pi package adds default-on branch memory, a custom TUI, tools,
commands, and fixed prompt policies. Pi stores user state outside this package.
Instructions: [`AGENTS.md`](https://github.com/txreverted/pi-config/blob/main/AGENTS.md).

## Use

Requires Node 22.19.0 or newer.

```sh
npm ci --ignore-scripts
npx --no-install pi -e "$PWD"
npm run check
```

- `npm ci` may contact the npm registry. Pi loads extensions with the user's
  permissions. Prompt commands can make paid provider calls.
- Session memory is on by default. It sends bounded transcript chunks to the
  active model provider for paid observation and checkpoint calls. Observers
  run after Pi settles and pause when work starts. Compaction catch-up stops
  after two chunks or 45 seconds, then uses Pi's default compaction.
  Memory state stays in the Pi session. Use `/memory off` for that branch.
- `web_search` and `web_fetch` send queries and URLs to Firecrawl. They read
  `FIRECRAWL_API_KEY` from the environment and may consume Firecrawl credits.
- Policies do not control filesystem, shell, network, Git, or provider access.

## Change

- [`extensions/memory.ts`](extensions/memory.ts) provides default-on,
  branch-local memory through `/memory [on|off|status|compact|search]`,
  `memory_search`, and deferred `memory_source`. Recall returns at most five
  observations. Source reads return bounded verbatim excerpts from eight
  active-branch entries. See [`test/memory-extension.test.mjs`](https://github.com/txreverted/pi-config/blob/main/test/memory-extension.test.mjs).
- [`extensions/ask.ts`](extensions/ask.ts) provides `ask_user_question` in TUI
  and RPC sessions. It accepts 1-4 questions with 2-4 choices. `Other` answers
  stop at 2,000 UTF-8 bytes and 400 lines. Its metadata estimate is at most 400 tokens. See
  [`test/ask-extension.test.mjs`](https://github.com/txreverted/pi-config/blob/main/test/ask-extension.test.mjs).
- [`extensions/web.ts`](extensions/web.ts) provides Firecrawl-backed `web_search`
  and `web_fetch`. Search accepts 500 characters, 1-10 results, and 10 domains
  per filter. Tool output stops at 2,000 lines or 50KB. Responses stop at 10MB.
  Complete truncated output goes to a temporary file. See
  [`test/web-core.test.mjs`](https://github.com/txreverted/pi-config/blob/main/test/web-core.test.mjs).
- [`extensions/ui.ts`](extensions/ui.ts) configures the editor, footer, thinking
  colors, response duration, compact rows, and wrapped input. `/fast [on|off]`
  adds the priority tier only for official OpenAI GPT-5.6 APIs and persists on
  the current branch. See [`test/ui-extension.test.mjs`](https://github.com/txreverted/pi-config/blob/main/test/ui-extension.test.mjs).
- [`extensions/ponytail.ts`](extensions/ponytail.ts) and
  [`extensions/unslop.ts`](extensions/unslop.ts) append fixed policies in that
  order. Their combined estimate is at most 2,000 tokens. Runtime text is
  [`policies/UNSLOP.md`](policies/UNSLOP.md). See
  [`test/policies.test.mjs`](https://github.com/txreverted/pi-config/blob/main/test/policies.test.mjs).
- [`/R-DOCS [scope]`](prompts/R-DOCS.md) rebuilds docs, including
  replacing dirty in-scope docs without confirmation. [`/R-GIT`](prompts/R-GIT.md) pushes checked
  work and merges green PRs without confirmation. [`/R-IMPL [scope]`](prompts/R-IMPL.md)
  audits without editing unless asked. Their prompt expansions combine to at most 775 tokens. See
  [`test/config.test.mjs`](https://github.com/txreverted/pi-config/blob/main/test/config.test.mjs).

Policy sources: [Ponytail](https://github.com/DietrichGebert/ponytail/blob/2ed6c52c9d7e5e56942508591085fd45dea277d3/skills/ponytail/SKILL.md), [Unslop](https://github.com/cursor/plugins/blob/99559f2f52047978602ef365589275831e76af07/pstack/skills/unslop/SKILL.md), and [Caveman](https://github.com/JuliusBrussee/caveman/blob/2f49f0e1a352aa810e70056b7930aeb0b3d219b4/src/rules/caveman-activate.md).
Notices: [`ponytail.LICENSE`](policies/ponytail.LICENSE), [`unslop.LICENSE`](policies/unslop.LICENSE), and [`caveman.LICENSE`](policies/caveman.LICENSE).
Memory adapts [Observational Memory](https://github.com/amosblomqvist/pi-observational-memory/tree/78a1efcfdd46332253fb289724f05b26dfc7769e). Notice: [`observational-memory.LICENSE`](extensions/observational-memory.LICENSE).

## Verify

`npm run check` type-checks, tests, packs, installs without development
dependencies, and loads through isolated offline Pi state. It makes no model or
Firecrawl calls. See [CI](https://github.com/txreverted/pi-config/actions/workflows/check.yml).

## Troubleshoot

- Run `/reload` or restart Pi after source changes.
- Restart Pi after setting `FIRECRAWL_API_KEY`.
- Stop Pi with `/quit` or Ctrl+C twice.
- Check [`package.json`](package.json) for enabled extensions and prompts.
- Never commit credentials, auth settings, Pi state, sessions, or transcripts.
