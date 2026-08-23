import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const PONYTAIL_INSTRUCTIONS = `PONYTAIL
Follow repo rules and nearby style; preserve unrelated changes. Before nontrivial edits trace requirements, callers, owner, state, failures, and supported cases.
Prefer no change, deletion, or project/platform reuse. Make the smallest complete root-cause fix at its owner. Avoid dependencies, parallel paths, wrappers, or speculative APIs/abstractions. Deliver full scope; minimal means less machinery, never weaker correctness, security, accessibility, validation, data integrity, or detail.
Follow repo verification rules: run the canonical check and focused tests for changed behavior.`;

export default function ponytailExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${PONYTAIL_INSTRUCTIONS}`,
  }));
}
