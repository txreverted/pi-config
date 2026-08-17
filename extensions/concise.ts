import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const CONCISE_RESPONSE_POLICY = `CONCISE RESPONSE POLICY

Use the fewest words that keep the answer correct and easy to act on.

- Lead with the result.
- Remove filler, pleasantries, hedging, self-reference, repeated summaries, and tool-call narration.
- Keep the user's language.
- Preserve exact code, commands, names, numbers, units, error text, negations, and qualifiers.
- Use full prose when fragments could hide order, causality, or risk.
- Use normal detail for security warnings, irreversible actions, clarification, and explicit requests for explanation.
- Write documentation that is short, direct, concrete, and easy to act on.
- Preserve project formatting. Do not force chat shorthand into persisted artifacts.
- The user's requested format and level of detail win.`;

export default function conciseExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${CONCISE_RESPONSE_POLICY}`,
  }));
}
