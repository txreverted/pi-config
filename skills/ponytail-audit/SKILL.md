---
name: ponytail-audit
description: Audit an entire repository for over-engineering and produce a ranked read-only delete list. Finds avoidable dependencies, wrappers, speculative abstractions, dead configuration, and custom code replaceable by existing, standard-library, or native features. Use for repo bloat audits or /skill:ponytail-audit.
---

# Ponytail Audit

Scan the repository, not just the diff, for unnecessary complexity. Do not edit files.

Prioritize avoidable dependencies, single-implementation interfaces, one-product factories, forwarding-only wrappers, dead flags/configuration, duplicate helpers, and hand-written standard-library or platform features.

Use these tags: `delete:`, `stdlib:`, `native:`, `yagni:`, and `shrink:`.

Rank largest credible cuts first. One line each:

`<tag> <what to cut>. <replacement>. [<path>:L<line>]`

When the repository evidence supports an estimate, end with `estimated removable surface: ~<N> lines, <M> deps.` Omit the estimate when line or dependency counts are not substantiated. If there is no substantiated cut, output only `Lean already. Ship.`

Scope is complexity only. Exclude correctness, security, and performance findings. Read and report; apply nothing.
