---
description: Evidence-based implementation audit
argument-hint: "[scope]"
---
Audit the current implementation.

Scope: ${ARGUMENTS:-entire repository}.

Read repository instructions. Understand architecture, runtime paths, config, tests, and dependencies.

Score each category independently out of 10:

- Correctness
- Simplicity
- Maintainability
- Tests
- Performance
- Security

Give evidence and a short rationale for every score. Report strengths and findings ranked by impact.

- Cite exact files and symbols.
- Separate facts from inference.
- Explain concrete risk or cost.
- Prefer the smallest root-cause fix.
- Do not assume a rewrite is better.
- Do not suggest speculative abstractions.
- Do not modify code unless explicitly asked.
- Say when no change is needed.
