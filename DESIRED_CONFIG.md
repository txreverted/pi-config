# Desired Config

This file is the frozen source of truth for this repository. Do not edit, expand, reformat, or regenerate it.

The final Pi config is minimal and contains only:

- Ponytail, to produce cleaner code.
- Caveman-style output and documentation: short, direct, concrete, and easy to act on.
- Todos with Claude Code-like UI and logic.
- A Claude Code-like ask-user tool.
- Goal mode, so long-running work continues until it is done or the user stops it.
- Web search that requires no API key or credentials.
- Practical command-line tools such as `rg`, `find`, and `jq`.
- These approved UI elements only: `□`, `■`, `☒`, `⎿`, `├`, `─`, `│`, `└`, `<`, `>`, `〉` and Pi's default animated loader.
Prefer Pi built-ins, platform features, command-line tools, and small local implementations. Do not add or import a Pi extension or package when the needed behavior can reasonably be implemented locally.

## Prompt Templates

   Use Pi's built-in prompt templates. Do not build a prompt extension.

   Files:

   ```text
   prompts/
   ├── r-docs.md
   ├── r-impl.md
   └── r-git.md
   ```

   The package manifest must include:

   ```json
   {
     "files": ["extensions", "prompts", "skills", "subagents", "themes", "README.md"],
     "pi": {
       "prompts": ["./prompts"]
     }
   }
   ```

   ### `/r-docs`

   File: `prompts/r-docs.md`

   ```markdown
   ---
   description: Audit and simplify repository documentation
   argument-hint: "[scope]"
   ---
   Audit the repository documentation.

   Scope: ${ARGUMENTS:-entire repository}.

   - Read repository instructions first.
   - Understand current code, config, tests, and behavior.
   - Inventory every `.md` file.
   - Classify files as human docs, instructions, frozen scope, or runtime code.
   - Never edit frozen files.
   - Keep, merge, or delete human docs based on unique current value.
   - Remove stale, duplicated, speculative, roadmap, and code-obvious content.
   - Keep one clear entry point.
   - Use short sentences, exact paths, commands, examples, and relative links.
   - Verify every technical claim.
   - Do not change source code or runtime Markdown unless explicitly included.

   Report files kept, merged, deleted, protected, and unresolved doc/code mismatches.
   ```

   ### `/r-impl`

   File: `prompts/r-impl.md`

   ```markdown
   ---
   description: Evidence-based implementation audit
   argument-hint: "[scope]"
   ---
   Audit the current implementation.

   Scope: ${ARGUMENTS:-entire repository}.

   Read repository instructions. Understand architecture, runtime paths, config, tests, and dependencies.

   Score out each of 10:

   - Correctness
   - Simplicity
   - Maintainability
   - Tests
   - Performance
   - Security

   Report strengths and findings ranked by impact.

   - Cite exact files and symbols.
   - Separate facts from inference.
   - Explain concrete risk or cost.
   - Prefer the smallest root-cause fix.
   - Do not assume a rewrite is better.
   - Do not suggest speculative abstractions.
   - Do not modify code unless explicitly asked.
   - Say when no change is needed.
   ```

   ### `/r-git`

   File: `prompts/r-git.md`

   ```markdown
   ---
   description: Split unstaged work into coherent PRs and merge it
   ---
   Process all unstaged and untracked work into the smallest safe set of coherent pull requests.

   Run autonomously. Do not ask before committing, pushing, opening PRs, or merging.

   Inspect repository instructions, status, branches, remotes, diffs, untracked files, worktrees, checks, and branch protection first.

   - Preserve existing work.
   - Never reset, discard, or overwrite changes.
   - Preserve unrelated staged changes.
   - Never commit secrets, auth, settings, sessions, transcripts, ignored files, or unrelated work.
   - Group changes by independent intent.
   - Keep tests and required docs with their implementation.
   - Create clear branches and atomic commits.
   - Run relevant tests, lint, and typechecks.
   - Push and open focused PRs.
   - Keep dependent PRs ordered.
   - Wait for required checks.
   - Merge only when repository rules allow it.
   - Never bypass checks, reviews, protection, hooks, or conflicts.
   - Never force-push.
   - Stop when changes cannot be separated safely.

   Use `main` when it is the verified target. Otherwise use the default branch.

   Report PRs, branches, commits, checks, merges, blockers, excluded files, and final status.
   ```

## Sources

   Source priority:

   1. Repository instructions govern work.
   2. This file governs product scope.
   3. Code and tests describe current behavior.
   4. Pi documentation governs Pi APIs.
   5. Claude Code documentation is a UX reference only.

   ### Local

   - [Repository map](README.md)
   - [Agent rules](AGENTS.md)
   - [Tests](test/)

   ### Pi

   - [Extensions](https://pi.dev/docs/latest/extensions)
   - [TUI components](https://pi.dev/docs/latest/tui)
   - [Prompt templates](https://pi.dev/docs/latest/prompt-templates)
   - [Pi packages](https://pi.dev/docs/latest/packages)

   ### Claude Code references

   - [Tools reference](https://code.claude.com/docs/en/tools-reference)
   - [Subagents](https://code.claude.com/docs/en/subagents)
   - [Permissions](https://code.claude.com/docs/en/permissions)

   Claude Code is a design reference. Exact compatibility is not required.
