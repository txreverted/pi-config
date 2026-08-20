import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const skill = readFileSync(new URL("../skills/unslop/SKILL.md", import.meta.url), "utf8")
  .replace(/\r\n?/g, "\n")
  .replace(/^---\n[\s\S]*?\n---\n+/, "")
  .trim();

export const UNSLOP_INSTRUCTIONS = `UNSLOP MODE ACTIVE

Apply these instructions to all writing.

${skill}`;

export default function unslopExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${UNSLOP_INSTRUCTIONS}`,
  }));
}
