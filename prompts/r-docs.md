---
description: Make repository docs technical and agent-friendly
argument-hint: "[scope]"
---
Improve repository documentation. Edit it now.

Scope: ${ARGUMENTS:-entire repository}.

- Read applicable `AGENTS.md` files first and obey them. Verify docs against code, config, tests, and behavior.
- Inventory tracked project `.md` files; skip vendored, ignored, and rule-barred files. Classify others as human docs, instructions, runtime code, generated, or frozen. Keep labels internal.
- Edit named scope only. Never hand-edit generated or frozen content. Change instructions or runtime Markdown only when named and repository rules allow; preserve behavior.
- When root `README.md` is in scope, make it the operational map. Omit unsupported sections; order them as follows:
  - title and two to four concrete sentences naming inputs, outputs, and optional behavior; required instructions link near top;
  - `Current state`: authoritative generated or measured facts with scope and limits;
  - `Flow`: short fenced `text` path, then ownership and dependency boundaries;
  - `Code`: major areas linked to source and representative tests;
  - `Setup and checks`: requirements, canonical check, coverage, and side effects;
  - `Run`: shortest safe start, stop, and recovery paths;
  - `Runtime state and constraints`: owners, private data, security, licensing, release, and live-operation limits;
  - `Related docs`: every other tracked project `.md`, grouped by reader task with a short purpose.
- Preserve generation markers. Use the owning generator only when scope and repository rules allow. Never invent state, metrics, commands, or operations.
- Use tables only for column comparisons: `Item | Current value` for state and `Area | Source | Tests` for code maps. Use compact bullets otherwise.
- Keep non-root Markdown scoped to its area. Explain non-obvious behavior or architecture only when useful; do not repeat root overview.
- Separate local checks from paid calls, deploys, migrations, pushes, and live operations. Never perform the latter without explicit authority.
- Write for agents and humans. Prefer exact paths, symbols, commands, links, task headings, and short examples.
- Apply the active Caveman policy: few words, no filler, but full prose for order, causality, limits, or risk. Preserve technical substance and project formatting; no chat shorthand in docs.
- Preserve useful explanations. Remove stale, repeated, historical, speculative, roadmap, generic, and code-obvious text.
- Keep useful canonical first-party sources beside claims. Put app-wide sources in root README; use versioned sources only for version-specific claims.
- Verify every edited claim, command, path, link, and source.
- Do not merge, move, or delete Markdown unless scope explicitly requests it. Do not change non-Markdown files.

Report changed files and unresolved doc/code mismatches. Omit unchanged-file lists.
