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
