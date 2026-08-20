---
description: Split unstaged changes into PRs and merge them
---
Analyze every unstaged change and untracked file. Group them by intent into the smallest coherent pull requests.

For each group:

1. Create a branch from the verified default branch.
2. Commit only that group. Keep its code, tests, and docs together.
3. Push the branch, open a pull request, and merge it.

Process dependent groups in order.

- Read repository rules and inspect Git first.
- Keep existing work. Never reset, discard, overwrite, or force-push.
- Include related staged changes. Leave unrelated staged changes alone.
- Never commit secrets, ignored files, or unrelated work.
- Run no local checks.
- Never bypass checks, reviews, branch protection, hooks, or conflicts.

Report merged pull requests and blockers.
