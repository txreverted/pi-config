---
description: Implement a change, check it, then request one fresh read-only review
argument-hint: "<implementation objective>"
---
Implement this authorized change in the current checkout:

$ARGUMENTS

Keep unrelated user changes, run deterministic checks, then call `subagent` once with the `reviewer` role to inspect the resulting working tree. Verify and address confirmed findings yourself. Report changed files and checks.
