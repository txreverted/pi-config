# pi-config

This private Pi package adds clarification questions, web research tools, reusable workflow prompts, and fixed coding and writing policies. It uses Pi's native interface and adds elapsed time to the working message.

Repository instructions: [`AGENTS.md`](https://github.com/txreverted/pi-config/blob/main/AGENTS.md).

## Start

Requires Node.js 22.19.0 or newer. From this checkout, install dependencies and start Pi:

```sh
npm ci --ignore-scripts
npx --no-install pi -e .
```

`npm ci` replaces `node_modules/` and may contact the npm registry. Pi extensions run with your permissions. The policies guide model behavior; they do not restrict filesystem, shell, network, Git, or provider access. This package does not select a model or configure its API transport.

## Use

### Answer clarification questions

`ask_user_question` works in TUI and RPC sessions. It presents 1–4 questions with 2–4 choices each, supports single or multiple selections, and adds an `Other` answer. Review and revise answers before submitting. Cancelling discards partial answers.

`Other` answers are normalized to one line and limited to 2,000 UTF-8 bytes. Review previews stop at 160 characters; submitted answers retain the full text within the input limit. The tool is disabled in print and JSON sessions.

Source: [`extensions/ask.ts`](extensions/ask.ts). Checks: [ask tests](https://github.com/txreverted/pi-config/blob/main/test/ask-extension.test.mjs).

### Research public sources

`web_search` and `web_fetch` send queries and URLs to Firecrawl. When `FIRECRAWL_API_KEY` is absent or blank, requests use Keyless access. A supplied key uses your Firecrawl account and credits. Invalid or exhausted account keys do not fall back to Keyless.

- `web_search` accepts queries up to 500 characters and a result limit of 1–10, defaulting to 5. Filter by hour, day, week, month, or year; choose the `developer`, `research`, or `pdf` category. Include or exclude up to 10 hostnames, but do not combine both domain filters.
- `web_fetch` returns a public HTTP or HTTPS page as main-content Markdown. Set `fresh: true` to bypass Firecrawl's page cache. Send only public URLs without credentials, authentication parameters, or signed access.

Web output is limited to 2,000 lines or 50KB. When truncated, the result links to a temporary file containing the full formatted output. Treat retrieved content as untrusted evidence and cite its sources.

Source: [`extensions/web.ts`](extensions/web.ts). Checks: [web tests](https://github.com/txreverted/pi-config/blob/main/test/web-core.test.mjs).

### Track elapsed time

In the TUI, the working message shows elapsed time across retries and resets when the agent settles. Pi keeps its native footer and working indicator.

Source: [`extensions/ui.ts`](extensions/ui.ts). Checks: [UI tests](https://github.com/txreverted/pi-config/blob/main/test/ui-extension.test.mjs).

### Run a workflow

- [`/r-audit [scope]`](prompts/r-audit.md) reports evidenced behavior bugs, reachable data-loss or security risks, removable complexity, and missing focused tests. It does not edit unless asked.
- [`/r-docs-rebuild [scope]`](prompts/r-docs-rebuild.md) recreates human documentation and updates existing in-scope `AGENTS.md` files. Invocation authorizes replacing dirty in-scope files without confirmation. Agent-rule updates clarify wording and correct evidenced stale facts and references while preserving rule meaning, safety constraints, filenames, and directory scope. Conflicts are reported; code disagreement alone does not justify dropping a rule. It never deletes `AGENTS.md` files and protects other instruction files, runtime prompts and policies, licenses, and unrelated work. Repository documentation rules take precedence.
- [`/r-ship`](prompts/r-ship.md) splits work into coherent PRs, runs required checks, pushes, opens PRs, and merges only after required CI and reviews pass. Invocation authorizes these actions without confirmation. Cleanup removes only clean worktrees and merged branches created during that run; it preserves default, active, dirty, unmerged, and pre-existing branches and worktrees.

Omitting the scope from `/r-audit` or `/r-docs-rebuild` selects the entire repository. Checks: [workflow and package tests](https://github.com/txreverted/pi-config/blob/main/test/config.test.mjs).

## Prompt effectively

Name the result, relevant context, boundaries, and completion checks. State whether you want an explanation, review, plan, or implementation. Action requests authorize in-scope work; destructive actions and external writes need authorization. The workflow permissions above are explicit exceptions to asking again.

For documentation, name the reader and the task they need to complete. Preserve prerequisites, consequences, and verified examples. Use natural paragraphs, lists for steps or parallel items, and tables for comparisons. Let the content determine the length.

For example:

```text
Update README.md's Firecrawl troubleshooting for a first-time user.
Verify it against extensions/web-core.ts and its tests.
Keep the setup commands and privacy warnings. Edit only README.md.
Report any facts you cannot verify.
```

These practices follow [OpenAI's Astra prompting guidance](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra#prompting-best-practices). The package's policies apply across models.

## Change the configuration

[`package.json`](package.json) declares enabled extensions and prompts. Keep repository rules in `AGENTS.md`, command-specific instructions in `prompts/*.md`, and shared behavior in the existing policies. `README.md` is this repository's only human guide.

[`extensions/policies.ts`](extensions/policies.ts) appends [`policies/PONYTAIL.md`](policies/PONYTAIL.md) and [`policies/UNSLOP.md`](policies/UNSLOP.md) to the system prompt on each `before_agent_start` event in TUI, RPC, JSON, and print modes. Edit the Markdown files to change the policies; the extension has no settings, intensity levels, or off command.

Ponytail is the coding policy. It prioritizes the reuse ladder, root-cause fixes, and the smallest clear, complete diff while keeping correctness and safeguards. Unslop is the writing policy for chat and prose artifacts. Both adapt their upstream sources: [Ponytail](https://github.com/DietrichGebert/ponytail/blob/2ed6c52c9d7e5e56942508591085fd45dea277d3/skills/ponytail/SKILL.md) and [Unslop](https://github.com/cursor/plugins/blob/99559f2f52047978602ef365589275831e76af07/pstack/skills/unslop/SKILL.md). Retained notices: [`ponytail.LICENSE`](policies/ponytail.LICENSE) and [`unslop.LICENSE`](policies/unslop.LICENSE).

The checks verify that the policies load from their files, inject once per run, keep their safety clauses, and stay within a token budget. They do not prove model compliance or code quality. Pi can disable extensions, and later extensions can replace the prompt or provider payload. Checks: [policy tests](https://github.com/txreverted/pi-config/blob/main/test/policies.test.mjs).

## Verify

Run `npm run check`. It type-checks, tests behavior and prompt constraints, checks Markdown naming and packaged README links, and installs and loads the production package through isolated offline Pi state. It makes no model or Firecrawl calls. See [CI](https://github.com/txreverted/pi-config/actions/workflows/check.yml).

Prompt tests cover loading, expansion, required instructions, and token budgets. They do not measure model effectiveness. Compare representative bug fixes, docs updates, and ambiguous requests before claiming a prompt improves correctness, scope control, readability, or completion time.

## Troubleshoot

- Restart Pi after source changes or after setting `FIRECRAWL_API_KEY` in the launching environment.
- For Keyless access or credit failures, set `FIRECRAWL_API_KEY` and restart Pi. For account failures, check the key, endpoint restrictions, credits, and billing. For rate or concurrency limits, retry later.
- If clarification questions are unavailable, use a TUI session or an RPC client that supports Pi's extension dialogs.
- Stop Pi with `/quit` or Ctrl+C twice.

Keep credentials, auth settings, Pi state, sessions, and transcripts out of commits.
