---
name: ponytail-debt
description: Find deliberate `ponytail:` shortcut comments and turn them into a read-only debt ledger with ceilings, revisit triggers, and missing-trigger warnings. Use for deferred Ponytail work, shortcut inventories, debt ledgers, or /ponytail-debt.
---

# Ponytail Debt

Search tracked source for actual comment markers containing `ponytail:`. Skip `.git`, dependencies, generated files, and build output. Recognize the repository's comment syntax, including `#`, `//`, `/*`, and `<!--` where applicable.

For every marker, report:

`<file>:<line>, <shortcut>. ceiling: <limit>. upgrade: <revisit trigger>.`

The convention is `ponytail: <ceiling>; upgrade when <trigger>`. Add `no-trigger` when the comment lacks a concrete upgrade path or measurable revisit condition. Group rows by file.

End with `<N> markers, <M> with no trigger.` If none exist, output only `No ponytail: debt. Clean ledger.`

Read and report only. Write a ledger file only if the user explicitly asks.
