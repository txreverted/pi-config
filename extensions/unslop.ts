import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const policy = readFileSync(new URL("../policies/UNSLOP.md", import.meta.url), "utf8")
  .replace(/\r\n?/g, "\n")
  .trim();

export const UNSLOP_INSTRUCTIONS = `UNSLOP
${policy}`;

export default function unslopExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${UNSLOP_INSTRUCTIONS}`,
  }));
}
