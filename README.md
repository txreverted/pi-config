# pi-config

This private Pi package adds clarification questions and fixed coding and writing policies. It uses Pi's native interface and built-in providers.

Repository instructions: [`AGENTS.md`](https://github.com/txreverted/pi-config/blob/main/AGENTS.md).

## Start

Requires Node.js 22.19.0 or newer. From this checkout, install dependencies and start Pi:

```sh
npm ci --ignore-scripts
npx --no-install pi -e .
```

`npm ci` replaces `node_modules/` and may contact the npm registry. Pi extensions run with your permissions. The policies guide model behavior; they do not restrict filesystem, shell, network, Git, or provider access.

## Use

### Choose a provider and model

Start Pi with this package, run `/login`, and select a built-in provider. Follow Pi's authentication prompts, then run `/model` to choose a model. Press Ctrl+S in the model picker to save the highlighted model as your startup default.

Pi also accepts provider-specific environment variables for API keys. See [Pi's provider documentation](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/providers.md) for authentication options. With credentials configured, list available models without making a model call:

```sh
npx --no-install pi -e . --list-models
```

Pi manages provider catalogs and authentication. Login credentials are stored in the user's private `~/.pi/agent/auth.json`. Do not put API keys in this repository or paste them into chat. Model calls send conversation content to the selected provider and may incur provider charges.

### Answer clarification questions

`ask_user_question` works in TUI and RPC sessions. It presents 1–4 questions with 2–4 choices each, supports single or multiple selections, and adds an `Other` answer. Review and revise answers before submitting. Cancelling discards partial answers.

`Other` answers are normalized to one line and limited to 2,000 UTF-8 bytes. Review previews stop at 160 characters; submitted answers retain the full text within the input limit. The tool is disabled in print and JSON sessions.

Source: [`extensions/ask.ts`](extensions/ask.ts). Checks: [ask tests](https://github.com/txreverted/pi-config/blob/main/test/ask-extension.test.mjs).

## Prompt effectively

Name the result, relevant context, boundaries, and completion checks. State whether you want an explanation, review, plan, or implementation. Action requests authorize ordinary local edits within scope. Destructive actions and writes to remote or shared systems, such as pushes or deployments, need authorization.

For documentation, name the reader and the task they need to complete. Preserve prerequisites, consequences, and verified examples. Use natural paragraphs, lists for steps or parallel items, and tables for comparisons. Let the content determine the length.

For example:

```text
Update README.md's clarification-question instructions for a first-time user.
Verify them against extensions/ask.ts and its tests.
Keep the setup commands and privacy warnings. Edit only README.md.
Report any facts you cannot verify.
```

These practices follow [OpenAI's Astra prompting guidance](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra#prompting-best-practices). The package's policies apply across models.

## Change the configuration

[`package.json`](package.json) declares enabled extensions. Keep repository rules in `AGENTS.md` and shared behavior in the existing policies. `README.md` is this repository's only human guide.

[`extensions/policies.ts`](extensions/policies.ts) appends [`policies/PONYTAIL.md`](policies/PONYTAIL.md) and [`policies/UNSLOP.md`](policies/UNSLOP.md) to the system prompt on each `before_agent_start` event in TUI, RPC, JSON, and print modes. Edit the Markdown files to change the policies; the extension has no settings, intensity levels, or off command.

Ponytail is the coding policy. It prioritizes the reuse ladder, root-cause fixes, and the smallest clear, complete diff while keeping correctness and safeguards. Unslop is the writing policy for chat and prose artifacts. Both adapt reviewed upstream revisions: [Ponytail](https://github.com/DietrichGebert/ponytail/blob/e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156/skills/ponytail/SKILL.md) and [Unslop](https://github.com/cursor/plugins/blob/c1c0a32802223f4be824112dd83d33ad29a8b26c/pstack/skills/unslop/SKILL.md). Retained notices: [`ponytail.LICENSE`](policies/ponytail.LICENSE) and [`unslop.LICENSE`](policies/unslop.LICENSE).

The adaptations differ from upstream in these ways:

- Ponytail stays loaded at full strength, without intensity controls or stop commands. Investigations follow affected behavior, expanding when evidence points beyond a local change.
- Explicit requirements take precedence over shipping a reduced version. Regression checks use the repository's existing test stack.
- Unslop owns writing style. Ponytail imposes no three-line response limit.
- Unslop's style preferences are defaults, not blanket punctuation or vocabulary bans. Literal text, technical meaning, and the user's requested format take precedence.

The checks verify that the policies load from their files, inject once per run, keep their safety clauses, and stay within a token budget. They do not prove model compliance or code quality. Pi can disable extensions, and later extensions can replace the prompt or provider payload. Checks: [policy tests](https://github.com/txreverted/pi-config/blob/main/test/policies.test.mjs).

## Verify

Run `npm run check`. It type-checks, tests behavior and prompt constraints, checks Markdown naming and packaged README links, and installs and loads the production package through isolated offline Pi state. It makes no model calls. See [CI](https://github.com/txreverted/pi-config/actions/workflows/check.yml).

### Compare policy behavior

Policy tests do not measure model effectiveness. The [comparison fixtures](https://github.com/txreverted/pi-config/blob/main/test/fixtures/policy-cases.json) provide synthetic local and shared bugs, ambiguous and clear requests, and a documentation edit. They are manual evaluation inputs, not model tests run by `npm run check`.

1. Prepare separate package copies for the baseline and candidate, differing only in `policies/PONYTAIL.md` and `policies/UNSLOP.md`. Keep the model, reasoning level, tools, context files, and Pi version the same. Load only one package copy per session.
2. For each case and revision, copy the case's `files` into a fresh scratch directory. Start a fresh TUI session there and submit only its `prompt`. Keep `review` criteria out of model context. Supply `clarification`, where present, only if the agent asks.
3. Assess the result against each `review` criterion. Run the fixture's `npm test` where available and inspect the diff. Record correctness, unrelated edits, clarification quality, tool calls, and elapsed time. Keep sessions and transcripts outside this repository.
4. Repeat comparisons before claiming an improvement. Fewer calls or faster completion do not compensate for incorrect results or missing safeguards. Report cases not run and failures alongside successes.

These comparisons make model calls and may incur provider charges. Fixture validation checks structure and input budgets, not model compliance.

## Troubleshoot

- Restart Pi after source changes.
- If clarification questions are unavailable, use a TUI session or an RPC client that supports Pi's extension dialogs.
- Stop Pi with `/quit` or Ctrl+C twice.

Keep credentials, auth settings, Pi state, sessions, and transcripts out of commits.
