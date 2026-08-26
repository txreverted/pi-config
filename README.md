# pi-config

This private Pi package adds interactive tools, default-on branch memory, a
custom TUI, prompt templates, and fixed system-prompt policies. Pi keeps memory
records in its sessions and writes full copies of truncated web output to
temporary directories.

Repository instructions: [`AGENTS.md`](https://github.com/txreverted/pi-config/blob/main/AGENTS.md).

## Use

Requires Node.js 22.19.0 or newer.

```sh
npm ci --ignore-scripts
npx --no-install pi -e "$PWD"
npm run check
```

- `npm ci` replaces `node_modules/` and may contact the npm registry.
- Pi loads extensions with the user's permissions. Policies do not control filesystem, shell, network, Git, or provider access.
- Session memory is on by default. It sends bounded transcript chunks to the
  active model provider after Pi settles, so observer and compaction workers
  may make paid calls. Memory state stays in the Pi session. Use
  `/memory off` to disable it for that branch.
- Memory compaction catches up at most two chunks for up to 45 seconds. It uses
  Pi's default compaction if memory processing fails.
- `web_search` and `web_fetch` send queries and URLs to Firecrawl and may use
  Firecrawl credits. They read `FIRECRAWL_API_KEY` from the environment and can
  use keyless access when Firecrawl permits it.

## Change

- [`extensions/memory.ts`](extensions/memory.ts) provides default-on,
  branch-local memory. `/memory [on|off|status|compact|search]` controls it.
  `memory_search` returns at most five observations. `memory_source` reads at
  most eight active-branch entries after a matching search. See the [memory tests](https://github.com/txreverted/pi-config/blob/main/test/memory-extension.test.mjs).
- [`extensions/ask.ts`](extensions/ask.ts) provides `ask_user_question` in TUI
  and RPC sessions. It accepts 1-4 questions with 2-4 choices. `Other` answers
  stop at 2,000 UTF-8 bytes and 400 lines. Its metadata estimate is at most 400 tokens.
  See the [ask tests](https://github.com/txreverted/pi-config/blob/main/test/ask-extension.test.mjs).
- [`extensions/web.ts`](extensions/web.ts) provides Firecrawl-backed `web_search`
  and `web_fetch`. Search accepts 500 characters, 1-10 results, and 10 domains
  per filter. Tool output stops at 2,000 lines or 50KB. Firecrawl responses stop
  at 10MB. See the [web tests](https://github.com/txreverted/pi-config/blob/main/test/web-core.test.mjs).
- [`extensions/ui.ts`](extensions/ui.ts) replaces the TUI editor and footer. It
  colors startup resources and the working indicator by thinking level. See the
  [UI tests](https://github.com/txreverted/pi-config/blob/main/test/ui-extension.test.mjs).
- [`extensions/ponytail.ts`](extensions/ponytail.ts) and
  [`extensions/unslop.ts`](extensions/unslop.ts) append fixed policies on every
  agent run. Their combined estimate is at most 2,000 tokens. Runtime prose
  policy: [`policies/UNSLOP.md`](policies/UNSLOP.md). See the [policy tests](https://github.com/txreverted/pi-config/blob/main/test/policies.test.mjs).
- [`/R-DOCS [scope]`](prompts/R-DOCS.md) rebuilds docs. It includes replacing dirty in-scope docs without confirmation.
  [`/R-GIT`](prompts/R-GIT.md) merges green PRs without confirmation.
  [`/R-IMPL [scope]`](prompts/R-IMPL.md) audits without editing unless asked.
  Their prompt expansions combine to at most 775 tokens. See the [config tests](https://github.com/txreverted/pi-config/blob/main/test/config.test.mjs).

Policy sources: [Ponytail](https://github.com/DietrichGebert/ponytail/blob/2ed6c52c9d7e5e56942508591085fd45dea277d3/skills/ponytail/SKILL.md),
[Unslop](https://github.com/cursor/plugins/blob/99559f2f52047978602ef365589275831e76af07/pstack/skills/unslop/SKILL.md), and
[Caveman](https://github.com/JuliusBrussee/caveman/blob/2f49f0e1a352aa810e70056b7930aeb0b3d219b4/src/rules/caveman-activate.md).
Notices: [`ponytail.LICENSE`](policies/ponytail.LICENSE), [`unslop.LICENSE`](policies/unslop.LICENSE),
and [`caveman.LICENSE`](policies/caveman.LICENSE). Memory adapts
[Observational Memory](https://github.com/amosblomqvist/pi-observational-memory/tree/78a1efcfdd46332253fb289724f05b26dfc7769e).
Notice: [`observational-memory.LICENSE`](extensions/observational-memory.LICENSE).

## Verify

`npm run check` type-checks, runs the tests, packs the production package, and
loads it through isolated offline Pi state. It makes no model or Firecrawl
calls. See [CI](https://github.com/txreverted/pi-config/actions/workflows/check.yml).

## Troubleshoot

- Restart Pi after source changes or after setting `FIRECRAWL_API_KEY`.
- Stop Pi with `/quit` or Ctrl+C twice.
- Check [`package.json`](package.json) for enabled extensions and prompts.
- Never commit credentials, auth settings, Pi state, sessions, or transcripts.
