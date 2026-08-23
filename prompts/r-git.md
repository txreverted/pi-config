---
description: Split dirty work into checked PRs and merge them
---
Branch/commit/push/PR/merge allowed; do not confirm.

Read repo/Git rules. Check staged/unstaged/untracked names first. Stop on ignored/unclear names, credentials/keys, auth/settings, sessions/transcripts, or content secrets.

Smallest coherent PRs, dependency ordered. Each: merge dependencies; refresh/verify default; branch; commit only its group/tests/docs; run/fix required checks; push/open PR; await/fix required CI/reviews; merge only green.

Preserve work. Stop on blocked files or unsafe switch/separation/access/approval. Never stash/reset/discard/overwrite/force-push/bypass hooks/checks/CI/conflicts/reviews/protection. Report merges/blockers.
