import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const readPolicy = (name: string) =>
  `${name}\n${readFileSync(new URL(`../policies/${name}.md`, import.meta.url), "utf8").replace(/\r\n?/g, "\n").trim()}`;

export const PONYTAIL_INSTRUCTIONS = readPolicy("PONYTAIL");
export const UNSLOP_INSTRUCTIONS = readPolicy("UNSLOP");
export const POLICY_INSTRUCTIONS = `${PONYTAIL_INSTRUCTIONS}\n\n${UNSLOP_INSTRUCTIONS}`;

export default function policiesExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${POLICY_INSTRUCTIONS}`,
  }));
}
