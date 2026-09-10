---
description: Rebuild docs and update AGENTS.md, including dirty files
argument-hint: "[scope]"
---
Rebuild human docs and update existing `AGENTS.md` files. Scope: ${ARGUMENTS:-entire repository}. Dirty in-scope replacement needs no confirmation.

Read applicable `AGENTS.md`. Classify tracked/untracked/dirty Markdown owner/status. Protect other instruction files, runtime prompts/policies, generated/frozen files, licenses/notices, ignored/vendor content, unrelated changes. Old human docs are leads, not evidence; verify facts via code/config/tests/contracts/safe output.

For in-scope `AGENTS.md`: clarify wording and update evidenced stale facts/references. Preserve rule meaning, safety constraints, filenames, and directory scope. Never delete these files or drop rules merely because code disagrees. Report unresolved conflicts.

Repository rules override defaults: Uppercase Markdown basenames; lowercase `.md`. Rename files/references. Keep root `README.md`; add task docs only if permitted and needed. Prepare all replacements before writes/deletes; name dirty docs replaced. Write drafts, then delete only obsolete in-scope human docs. Edit Markdown only.

README: purpose, instruction links, safe setup/run/check commands, use/change/verify/troubleshoot facts. Match the reader's technical background. Put limits/side effects with behavior. Keep prerequisites and necessary detail; no fixed line count. Use exact paths and source/test links. Omit placeholders, inventories, history/roadmap, implementation narration.

Only required/documented Markdown checks. No paid calls/deploys/migrations/pushes/publishes/live operations. Verify claims/commands/paths/links/examples; flag unverified facts. Report created/updated/deleted docs, doc/code mismatches; omit unchanged.
