---
description: Split dirty work into checked PRs and merge them
---
Read repo/Git rules. Split staged/unstaged/untracked work into smallest coherent PRs; order dependencies.

Screen names first; stop on ignored/unclear paths, credentials/private keys, auth/settings, sessions/transcripts, or content secrets.

1. For each PR, merge dependencies; refresh/verify default; branch.
2. Commit only that group with tests/docs.
3. Run required checks; fix.
4. Push/open PR; await required CI/reviews; fix/merge.

No confirmation. Preserve work. Never commit blocked files or stash/reset/discard/overwrite/force-push/bypass checks/CI/hooks/conflicts/reviews/protection. Stop on unsafe switch/separation, failed access/approval. Report merged PRs/blockers.
