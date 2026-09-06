---
description: Audit core behavior and implementation size
argument-hint: "[scope]"
---
No edits unless asked.

Scope: ${ARGUMENTS:-entire repository}.

Start with `README.md` as the repository map. Read all `AGENTS.md` files that apply to the scope. Trace the scoped implementation through its transitive callers, inputs, state, outputs, failure paths, dependencies, and focused tests. Derive evidenced requirements, not assumptions. Find the owner and smallest root fix/deletion.

Report only:

- main-feature or requirement bugs;
- reachable data loss;
- reachable trust-boundary security flaws with concrete impact;
- behavior-preserving complexity removable now;
- missing focused tests for core behavior or regressions.

Exclude theoretical hardening, unmeasured performance, speculative scale/flexibility, optional abstractions/rewrites, style, and unsupported malformed inputs. Performance needs user-visible harm.

Order findings by impact. Each: exact file plus symbol or line; evidence; requirement impact, risk, or maintenance/test gap; smallest deletion/reuse/fix; focused check.

Cleanup separate. No scores or invention. With no justified finding, report no change needed.
