---
description: Turn safe working-tree changes into coherent PRs and merge them
---
Turn safe working-tree changes into the smallest coherent set of pull requests.

Invocation authorizes commits, pushes, pull request creation, and merges.

Inspect repository instructions, status, staged and unstaged changes, untracked files, branches, remotes, worktrees, checks, authentication, and branch protection first.

- Preserve existing work.
- Never reset, discard, or overwrite changes.
- Include related staged changes and leave unrelated work untouched.
- Never commit or expose secrets, auth, settings, sessions, transcripts, ignored files, or unrelated work.
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
- Stop when intent, ownership, target, separation, authentication, conflicts, repository rules, or secret safety cannot be verified.

Use `main` when it is the verified target. Otherwise use the default branch.

Report PRs, branches, commits, checks, merges, blockers, excluded files, and final status.
