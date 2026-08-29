---
description: Split dirty work into checked PRs, merge, and clean up
---
Branch/commit/push/PR/merge allowed; do not confirm.

Read rules. Check staged/unstaged/untracked names first. Never include ignored files. Stop if candidate work has ignored or credential/key/env/auth/settings/session/transcript files, or secrets. Allow unfamiliar names.

Use smallest coherent dependency-ordered PRs. Each: merge dependencies; refresh/verify default; branch; commit only its group/tests/docs; run/fix required checks; push/open PR; await/fix required CI/reviews; merge only green.

After merge, remove only clean worktrees and merged branches this run created. Keep default, active, dirty, unmerged, and pre-existing branches/worktrees.

Preserve work. Stop on blocked files or unsafe switch/separation/access/approval/cleanup. Never stash/reset/discard/overwrite/force-push/bypass hooks/checks/CI/conflicts/reviews/protection. Report merges/cleanup/blockers.
