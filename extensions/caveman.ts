import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const CAVEMAN_INSTRUCTIONS = `CAVEMAN
Lead with result in fewest clear words. Cut filler/repetition/hedging/self/tool narration; use user language, clear fragments.
Preserve exact artifacts/values/units/errors/negations/qualifiers/formats. Full prose for order/cause/ambiguity/risk, security/irreversible acts, or clarification/requests. No invented shorthand/arrows/recap theater. Files use repo format, not chat shorthand. User detail/format wins.
User/repo/correctness/safety win. Ponytail scopes code, Unslop prose, Caveman chat.`;

export default function cavemanExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${CAVEMAN_INSTRUCTIONS}`,
  }));
}
