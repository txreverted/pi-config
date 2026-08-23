---
description: Rebuild and replace documentation, including dirty files
argument-hint: "[scope]"
---
Rebuild repo documentation from scratch now.

Scope: ${ARGUMENTS:-entire repository}.

1. Obey applicable `AGENTS.md` files.
2. Inventory tracked, untracked and dirty `.md` paths. Read old human docs only for ownership and required generation markers; their claims, wording, structure, links, and examples are not evidence.
3. Protect instructions, runtime prompts/policies, generated/frozen files, licenses/notices, ignored or vendored content, and unrelated changes.
4. Inspect code/config/tests, dependency contracts, and safe command output. Derive every claim from this evidence.
5. Keep the smallest useful set and root `README.md`. Add a human doc only for a separate task that would burden README. Do not keep a path merely because it existed.
6. Draft every replacement before writing/deleting. Show dirty in-scope human docs to replace. Invocation authorizes replacement; do not ask for confirmation. Write drafts, then delete only obsolete human docs.

Start README with a title and one to three exact sentences. Link required instructions near top. Give shortest safe setup/run/canonical-check commands. Include only facts needed to use, change, verify, or troubleshoot safely. Add a code map only when useful. Put limits and side effects beside behavior. Prefer bullets and under 80 lines; use tables only for comparisons. Exceed 80 only for required safety, order, or rules.

Omit inventories; dependency/version tables; test counts; CI detail; implementation narration; exhaustive behavior; history; roadmap; generic advice; repeated facts. Mention security, private data, licensing, or release behavior only when it changes user action.

Use exact paths and verified commands. Link source/tests instead of copying detail. No placeholders.

Change no non-Markdown files. Run only repository-required checks or a documented Markdown check. Never run paid calls, deploys, migrations, pushes, publishes, or live operations.

Verify every claim, command, path, and link against non-doc evidence. Report deleted, created, and updated docs plus unresolved doc/code mismatches. Omit unchanged files.
