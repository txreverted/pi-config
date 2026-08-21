---
description: Make repository docs technical and agent-friendly
argument-hint: "[scope]"
---
Improve the repository documentation. Edit it now.

Scope: ${ARGUMENTS:-entire repository}.

- Read every applicable `AGENTS.md` first. Obey repository rules.
- Inspect the code, config, tests, and current behavior before documenting them.
- Inventory tracked project `.md` files. Exclude generated, vendored, ignored, and rule-barred files.
- Classify each file as instructions, runtime code, human docs, or frozen. Preserve its audience and function.
- Apply content edits only within scope. Never edit frozen files. Edit instructions or runtime Markdown only when the scope names them and repository rules permit it.
- Make the root `README.md` the codebase overview when it is in scope. Include:
  - a few lines explaining what the codebase does;
  - its important technical concepts;
  - a rough architecture with concrete paths and component relationships;
  - a table linking every other tracked project `.md` file, with its class, purpose, and covered area.
- Keep every other Markdown file scoped to its own area. Briefly state its purpose, explain non-obvious technical concepts, and show where it fits in the architecture when that helps its reader. Do not repeat the whole-codebase overview.
- Treat prompts, skills, and instruction files as runtime code. Do not add prose that weakens or changes their behavior.
- Write for coding agents and humans working on the code. Prefer exact paths, symbols, commands, links, tables, and short examples.
- Preserve useful explanations. Remove stale facts, needless repetition, history, roadmap, speculation, generic advice, and code-obvious detail.
- Keep useful canonical first-party sources close to the concepts they support. Put app-wide sources in the root README. Use versioned sources for version-specific claims. Do not add sources merely to fill a section.
- Verify every edited claim, command, path, and link.
- Do not merge, move, or delete Markdown files unless the scope explicitly requests it.
- Do not change non-Markdown files.

Report changed files and unresolved doc/code mismatches. Omit unchanged-file lists.
