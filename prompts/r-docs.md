---
description: Make repository docs terse and agent-first
argument-hint: "[scope]"
---
Simplify the repository documentation. Edit it now.

Scope: ${ARGUMENTS:-entire repository}.

- Read every applicable `AGENTS.md` first. Obey repository rules.
- Inspect the code, config, tests, and current behavior.
- Inventory tracked project `.md` files. Exclude generated, vendored, ignored, and rule-barred files.
- Classify each file as instructions, runtime code, human docs, or frozen.
- Apply content edits only within scope. Never edit frozen files. Edit instructions or runtime Markdown only when the scope names them and repository rules permit it.
- Write for coding agents first. Keep facts needed to find, run, change, verify, or safely operate the repository.
- Use the fewest words that stay exact. Prefer paths, commands, tables, bullets, and clear fragments.
- Keep each fact in one place. Merge or delete human docs with no unique value.
- Remove intros, stale facts, duplication, history, roadmap, speculation, generic advice, and code-obvious detail.
- Make the root `README.md` the map when it is in scope. Link every other tracked project `.md` file with a relative link, including instructions and runtime Markdown. Do not link excluded files.
- Keep an external source only when it supports a retained claim. Prefer the closest canonical first-party page. Use a versioned page only for a version-specific claim. Remove redundant docs, source, release, changelog, and migration links.
- If external sources remain, end the root README with `## Sources`. State what each source supports. Otherwise omit the section.
- Verify every retained claim, command, path, and link.
- Do not change non-Markdown files.

Report changed or deleted files and unresolved doc/code mismatches. Omit unchanged-file lists.
