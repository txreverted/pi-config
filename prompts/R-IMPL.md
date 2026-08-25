---
description: Audit core behavior and implementation size
argument-hint: "[scope]"
---
Audit core code. Do not edit unless explicitly asked.

Scope: ${ARGUMENTS:-entire repository}.

Read applicable `AGENTS.md`. Derive explicit requirements/supported behavior from code/config/tests/repo rules, not assumptions. Trace caller/input/state/output/failure paths. Find owner and smallest root fix/deletion. Prefer no change if correct/minimal.

Report only:

- main-feature/requirement bugs;
- reachable trust-boundary data loss/security flaws;
- complexity removable without behavior change;
- missing focused nontrivial-core/regression tests.

Exclude theoretical hardening, unmeasured performance, speculative scale/flexibility, optional abstraction/rewrites, style, unsupported malformed inputs. Performance needs user-visible harm; security a reachable trust-boundary path with concrete impact.

Findings first. Each: exact file/symbol or line; behavior/evidence; feature/requirement impact; smallest fix, preferably deletion/reuse; focused check.

Separate cleanup; include only code/maintenance reduction now. No scores or invented findings. If no small fix is justified, report no change needed.
