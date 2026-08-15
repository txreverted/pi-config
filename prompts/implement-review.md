---
description: Start one background writer followed by two fresh read-only reviews
argument-hint: "<implementation objective>"
---
Run the `implement-review` workflow with `allowWrite: true` for this explicitly authorized implementation objective:

$ARGUMENTS

The background workflow may modify the current checkout. Use exactly one writer, preserve unrelated user changes, and report deterministic verification plus any confirmed review findings when it delivers.
