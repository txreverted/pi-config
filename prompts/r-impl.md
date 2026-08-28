---
description: Audit core behavior and implementation size
argument-hint: "[scope]"
---
Audit implementation. No edits unless asked.

Scope: ${ARGUMENTS:-entire repository}.

First explore entire codebase and read all `AGENTS.md`. Before reporting, fully understand its architecture, config, dependencies, tests, and every scoped caller/input/state/output/failure path. Derive evidenced requirements, not assumptions. Find the owner and smallest root fix/deletion.

Report only:

- main-feature or requirement bugs;
- reachable data loss;
- reachable trust-boundary security flaws with concrete impact;
- behavior-preserving complexity removable now;
- missing focused tests for core behavior or regressions.

Exclude theoretical hardening, unmeasured performance, speculative scale/flexibility, optional abstractions/rewrites, style, and unsupported malformed inputs. Performance needs user-visible harm.

Order findings by impact. Each: exact file plus symbol or line; evidence; requirement impact, risk, or maintenance/test gap; smallest deletion/reuse/fix; focused check.

Cleanup separate; only concrete reduction now. No scores or invention. With no justified finding, report no change needed.
