---
description: Split unstaged work into coherent PRs and merge it
---
Process all unstaged and untracked work into the smallest safe set of coherent pull requests.

Run autonomously. Do not ask before committing, pushing, opening PRs, or merging.

Inspect repository instructions, status, branches, remotes, diffs, untracked files, worktrees, checks, and branch protection first.

- Preserve existing work.
- Never reset, discard, or overwrite changes.
- Preserve unrelated staged changes.
- Never commit secrets, auth, settings, sessions, transcripts, ignored files, or unrelated work.
- Group changes by independent intent.
- Keep tests and required docs with their implementation.
- Create clear branches and atomic commits.
- Run relevant tests, lint, and typechecks.
- Push and open focused PRs.
- Keep dependent PRs ordered.
- Wait for required checks.
- Merge only when repository rules allow it.
- Never bypass checks, reviews, protection, hooks, or conflicts.
- Never force-push.
- Stop when changes cannot be separated safely.

Use `main` when it is the verified target. Otherwise use the default branch.

Report PRs, branches, commits, checks, merges, blockers, excluded files, and final status.
