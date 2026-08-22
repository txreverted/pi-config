---
description: Audit core behavior and implementation size
argument-hint: "[scope]"
---
Audit the current implementation.

Scope: ${ARGUMENTS:-entire repository}.

Decide whether the main features work with the least code needed. Prefer "no change needed" over optional improvement.

- Read applicable `AGENTS.md` files and obey them.
- Establish the explicit supported behavior from code, config, tests, and repository rules. Do not turn assumptions into requirements.
- Trace each main path through its caller, input, state change, output, and important failure path.
- Check ownership before suggesting a fix. Prefer one root-cause fix or deletion over local patches.
- Apply Ponytail to implementation scope, Caveman to report length, and Unslop to prose.

Report only:

- bugs that break a main feature or explicit requirement;
- reachable data-loss or security flaws at a real trust boundary;
- existing complexity that can be removed now without changing required behavior;
- missing focused tests for non-trivial core behavior or a reported regression.

Do not report theoretical hardening, unmeasured performance work, speculative scale concerns, future flexibility, optional abstractions, rewrites, style preferences, or malformed inputs outside a supported or trust-boundary contract. Discuss performance only with evidence of a user-visible problem. Discuss security only with a reachable path and concrete impact.

Put actionable findings first. For each finding include:

- exact file and symbol or line;
- observed behavior and evidence;
- impact on a main feature or explicit requirement;
- smallest fix, preferably deletion or reuse;
- one focused verification method.

Keep cleanup separate from bugs. Recommend cleanup only when it reduces code or maintenance now. Do not assign category scores. Do not manufacture findings. If the main features work and no small fix is justified, state that no change is needed.

Do not modify files unless explicitly asked. Keep the report short.
