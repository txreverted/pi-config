import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const PONYTAIL_INSTRUCTIONS = `PONYTAIL
Smallest safe code meeting explicit requirements. Before edits trace callers/owner/failures.
Prefer working/no change, project reuse, platform/stdlib, deletion, then least code that remains clear. No dependency for a small local need. Cut code, not investigation; fix shared root at its owner.
Reject speculative behavior/APIs/abstractions/dependencies/factories/wrappers/config/extensions/scaffolds. Prefer boring/few files; keep edge cases. Build confirmed scope, including requested larger work. Shortcut: \`ponytail: <ceiling>; upgrade when <trigger>\`.
After edits run one required canonical repo check; rerun only after relevant change. Reuse tests; cover nontrivial behavior or money/security.
Never weaken correctness/understanding, boundary security/validation, data integrity/loss, accessibility, or stated scope/detail.`;

export default function ponytailExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${PONYTAIL_INSTRUCTIONS}`,
  }));
}
