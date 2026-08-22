---
description: Rebuild minimal documentation from current code
argument-hint: "[scope]"
---
Rebuild repository documentation from scratch. Edit it now.

Scope: ${ARGUMENTS:-entire repository}.

1. Read applicable `AGENTS.md` files first and obey them.
2. Inventory tracked project `.md` files. Read old human docs only far enough to classify ownership and preserve required generation markers. Do not use their claims, wording, structure, links, or examples as evidence.
3. Delete every human documentation file in scope before drafting replacements. This command authorizes replacing dirty in-scope human docs. Preserve instruction files such as `AGENTS.md`, runtime prompts and policies, generated or frozen files, licenses and notices, ignored files, and vendored content. Preserve unrelated changes.
4. Inspect current code, config, tests, dependency contracts, and safe observed command output. Derive every new claim from that evidence.
5. Choose the smallest useful documentation set. Create a root `README.md`. Add another human doc only when it serves a separate concrete task that would make the README harder to use. Do not recreate an old path merely because it existed.
6. Write the new docs from zero.

Keep the root README practical and short:

- Start with the title and one to three exact sentences saying what the project does.
- Link required repository instructions near the top.
- Give the shortest safe setup, run, and canonical check commands that exist.
- Include only what a reader needs to use, change, verify, or troubleshoot the project safely.
- Add a compact code map only when it saves meaningful searching.
- Put limits and side effects beside the command or behavior they constrain.
- Prefer bullets. Use tables only for real column comparisons.
- Prefer fewer than 80 lines. Exceed that only when required safety, ordering, or repository rules cannot remain clear.

Omit file inventories, dependency and version tables, test counts, CI matrix details, implementation narration, exhaustive runtime behavior, history, roadmap, generic advice, and repeated facts. Mention security, private data, licensing, or release behavior only when it changes what the reader must do.

Use short sentences, exact paths, and verified commands. Link to source or tests instead of copying implementation detail. Do not add placeholders or speculative sections.

Do not change non-Markdown files. Run only checks required by repository rules or a documented Markdown-specific check. Never run paid calls, deploys, migrations, pushes, publishes, or live operations.

Verify every retained claim, command, path, and link against non-documentation evidence. Report deleted, created, and updated docs, plus unresolved doc/code mismatches. Omit unchanged-file lists.
