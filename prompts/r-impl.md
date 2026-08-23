---
description: Audit core behavior and implementation size
argument-hint: "[scope]"
---
Audit implementation.

Scope: ${ARGUMENTS:-entire repository}.

Decide if main features meet explicit requirements with the least code. Prefer "no change needed." Do not modify files unless explicitly asked.

- Read and obey applicable `AGENTS.md` files.
- Derive supported behavior from code, config, tests, and repository rules; assumptions are not requirements.
- Trace each main path: caller, input, state change, output, and important failure.
- Check ownership; prefer one root-cause fix or deletion over local patches.

Report only:

- bugs breaking a main feature or explicit requirement;
- reachable data loss or security flaws at a real trust boundary;
- existing complexity removable now without changing required behavior;
- missing focused tests for non-trivial core behavior or a reported regression.

Exclude theoretical hardening, unmeasured performance work, speculative scale, future flexibility, optional abstractions, rewrites, style, and malformed inputs outside supported or trust-boundary contracts. Performance requires user-visible harm; security requires a reachable path and concrete impact.

Put actionable findings first. Each gives:

- exact file and symbol or line;
- observed behavior and evidence;
- impact on a main feature or requirement;
- smallest fix, preferably deletion or reuse;
- one focused check.

Keep cleanup separate from bugs; include it only when it reduces code or maintenance now. No category scores or invented findings. If no small fix is justified, say no change is needed.
