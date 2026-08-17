---
name: ponytail-review
description: Review a diff only for unnecessary complexity and identify code, dependencies, abstractions, or flexibility that can be deleted or replaced by existing, standard-library, or native features. Use for over-engineering reviews, simplification reviews, or /skill:ponytail-review. Read-only.
---

# Ponytail Review

Review the current diff for complexity that can be removed. Do not apply fixes.

Report one finding per line:

`<file>:L<line>: <tag> <thing to remove>. <small replacement>.`

Tags:

- `delete:` dead code, speculative behavior, or unused flexibility; replacement is nothing.
- `stdlib:` custom code already provided by the language standard library.
- `native:` code or a dependency already covered by the platform or framework.
- `yagni:` an abstraction with one caller, implementation, or product; inline it until a second case exists.
- `shrink:` identical behavior with a materially smaller clear implementation.

Rank by removable line count. End with `net: -<N> lines possible.` If no substantiated cut exists, output only `Lean already. Ship.`

Do not report correctness, security, or performance bugs here; route those to a normal review. A small check for non-trivial logic is not bloat.
