---
description: Rebuild and replace documentation, including dirty files
argument-hint: "[scope]"
---
Rebuild docs. Scope: ${ARGUMENTS:-entire repository}. Invocation permits dirty in-scope replacement without confirmation.

Read applicable `AGENTS.md`. Classify tracked/untracked/dirty Markdown owner/status. Protect instructions, runtime prompts/policies, generated/frozen files, licenses/notices, ignored/vendor content, unrelated changes. Old docs are leads, not evidence, for owners/markers/voice/examples; verify from code/config/tests/contracts/safe output.

Prepare all replacements before writes/deletes; name dirty docs replaced. Keep root `README.md` plus docs for separate tasks that would burden it. Write all drafts, then delete only obsolete in-scope human docs. Edit Markdown only.

README: title; 1-3 exact opening sentences; required-instruction links near top; shortest safe setup/run/canonical-check commands. Only use/change/verify/troubleshoot facts. Put limits/side effects with behavior. Prefer bullets under 80 lines; tables only to compare. Use exact paths/verified commands and source/test links. Omit placeholders, inventories, version/CI tables, history/roadmap, implementation narration.

Only required/documented Markdown checks. No paid calls/deploys/migrations/pushes/publishes/live operations. Verify claims/commands/paths/links/examples. Report created/updated/deleted docs, doc/code mismatches; omit unchanged.
