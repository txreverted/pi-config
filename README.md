# pi-config

This private Pi package adds interactive tools, prompt templates, and fixed system-prompt policies. Truncated tool output keeps a full copy in a temporary directory.

Repository instructions: [`AGENTS.md`](https://github.com/txreverted/pi-config/blob/main/AGENTS.md).

## Use

- Requires Node.js 22.19.0 or newer.
- Short setup and run sequence:
  - `npm ci --ignore-scripts`
  - `npx --no-install pi -e "$PWD"`
- Verify command: `npm run check`
- `npm ci` replaces `node_modules/` and may contact the npm registry.
- Pi loads extensions with the user's permissions.
- Policies do not control filesystem, shell, network, Git, or provider access.
- `web_search` and `web_fetch` send queries and URLs to Firecrawl. Without `FIRECRAWL_API_KEY`, they automatically try experimental, undocumented Firecrawl Keyless.
- Supported [Firecrawl v2](https://docs.firecrawl.dev/api-reference/v2-introduction) usage requires an API key.

## Change

- [`extensions/ask.ts`](extensions/ask.ts) provides `ask_user_question` in TUI and RPC sessions. It accepts 1-4 questions with 2-4 choices. `Other` answers are normalized to one line and stop at 2,000 UTF-8 bytes. Its metadata estimate is at most 400 tokens. See the [ask tests](https://github.com/txreverted/pi-config/blob/main/test/ask-extension.test.mjs).
- [`extensions/web.ts`](extensions/web.ts) provides Firecrawl-backed `web_search` and `web_fetch`. Both automatically try experimental, undocumented Firecrawl Keyless without a key. Search accepts 500 characters, 1-10 results, 10 domains per filter, and the `developer`, `research`, and `pdf` categories. Fetch rejects local, private, and recognized signed URLs before forwarding. Tool output stops at 2,000 lines or 50KB. See the [web tests](https://github.com/txreverted/pi-config/blob/main/test/web-core.test.mjs).
- [`extensions/ui.ts`](extensions/ui.ts) adds elapsed time to Pi's native working message. Pi keeps its native footer and working indicator, including extension statuses. See the [UI tests](https://github.com/txreverted/pi-config/blob/main/test/ui-extension.test.mjs).
- [`extensions/ponytail.ts`](extensions/ponytail.ts), [`extensions/unslop.ts`](extensions/unslop.ts), and [`extensions/caveman.ts`](extensions/caveman.ts) append fixed policies on every agent run. Ponytail controls implementation scope, Unslop removes prose slop,
  and Caveman limits words in chat, docs, and other non-code output. Their combined estimate is at most 2,200 tokens. Runtime prose policy: [`policies/UNSLOP.md`](policies/UNSLOP.md). See the [policy tests](https://github.com/txreverted/pi-config/blob/main/test/policies.test.mjs).
- [`/r-docs [scope]`](prompts/r-docs.md) rebuilds docs, including replacing dirty in-scope docs without confirmation. [`/r-git`](prompts/r-git.md) merges green PRs without confirmation, then removes clean branches and worktrees it created. [`/r-impl [scope]`](prompts/r-impl.md) audits without editing unless asked. Their prompt expansions combine to at most 830 tokens. See the [config tests](https://github.com/txreverted/pi-config/blob/main/test/config.test.mjs).

Policy sources: [Ponytail](https://github.com/DietrichGebert/ponytail/blob/2ed6c52c9d7e5e56942508591085fd45dea277d3/skills/ponytail/SKILL.md), [Unslop](https://github.com/cursor/plugins/blob/99559f2f52047978602ef365589275831e76af07/pstack/skills/unslop/SKILL.md), and [Caveman](https://github.com/JuliusBrussee/caveman/blob/2f49f0e1a352aa810e70056b7930aeb0b3d219b4/src/rules/caveman-activate.md). Local adaptations keep Ponytail at fixed full strength, stop Unslop from inventing personality, and extend Caveman from replies to all non-code output. Notices: [`ponytail.LICENSE`](policies/ponytail.LICENSE), [`unslop.LICENSE`](policies/unslop.LICENSE), and [`caveman.LICENSE`](policies/caveman.LICENSE).

## Verify

`npm run check` type-checks, runs tests, packs the production package, and loads it through isolated offline Pi state. It makes no model or Firecrawl calls. See [CI](https://github.com/txreverted/pi-config/actions/workflows/check.yml).

## Troubleshoot

- Restart Pi after source changes or after setting `FIRECRAWL_API_KEY`.
- Check [`package.json`](package.json) for enabled extensions and prompts.
- Stop Pi with `/quit` or Ctrl+C twice.
- Never commit credentials, auth settings, Pi state, sessions, or transcripts.
