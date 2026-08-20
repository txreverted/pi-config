---
description: Group working-tree changes into PRs and merge them
---
Analyze every unstaged change and untracked file. Group them by intent into the smallest coherent set of pull requests.

Invocation authorizes branch creation, commits, pushes, pull request creation, and merges.

- Read repository instructions and inspect the current Git state.
- Preserve existing work. Never reset, discard, overwrite, or force-push.
- Include related staged changes. Leave unrelated staged work untouched.
- Never commit secrets, auth, settings, sessions, transcripts, ignored files, or unrelated work.
- Keep related tests and docs with their implementation.
- Create a branch and clear commit or commits for each group.
- Push each branch, open its pull request, and merge it.
- Process dependent groups in order.
- Do not run tests, lint, typechecks, or other local checks.
- Never bypass required checks, reviews, branch protection, hooks, or conflicts.

Use `main` when it is the verified target. Otherwise use the default branch.

Report pull requests, commits, merges, blockers, and excluded files.
