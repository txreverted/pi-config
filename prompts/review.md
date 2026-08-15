---
description: Review the working tree, then request one fresh read-only pass
argument-hint: "[review objective]"
---
Review this objective yourself:

${ARGUMENTS:-Review the current working tree for bugs, regressions, security issues, and important missing tests.}

Inspect the repository and diff directly. Then call `subagent` once with the `reviewer` role for an independent pass over the same objective. Verify its findings before reporting only confirmed issues.
