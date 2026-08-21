---
description: Evidence-based implementation audit
argument-hint: "[scope]"
---
Audit the current implementation.

Scope: ${ARGUMENTS:-entire repository}.

Read repository instructions. Understand architecture, runtime paths, config, tests, and dependencies.

Trace each reviewed behavior through its callers, inputs, state changes, outputs, and failure paths. Check whether the behavior belongs in its current owner and whether one root-cause fix can replace several local fixes.

Score each category independently out of 10:

- Correctness
- Simplicity
- Maintainability
- Tests
- Performance
- Security

Give evidence and a short rationale for every score. Use `not applicable` when a category does not apply and `not verified` when the available evidence cannot support a judgment. Do not invent performance or security concerns.

Report actionable findings before improvements. Keep bugs, security flaws, and data-loss risks separate from cleanup and design suggestions. For each finding include:

- Severity: critical, high, medium, or low
- Confidence: high, medium, or low
- Exact file and symbol or line
- Observed behavior
- Concrete impact
- Smallest root-cause fix
- Verification method

Evaluate tests by the behavior they cover: important branches, failure paths, boundaries, and regressions. Do not use test count as evidence of quality.

- Separate facts from inference.
- Do not assume a rewrite is better.
- Do not suggest speculative abstractions.
- Do not modify code unless explicitly asked.
- If there are no actionable findings, state that explicitly. Do not manufacture findings to fill categories.
- Say when no change is needed.
