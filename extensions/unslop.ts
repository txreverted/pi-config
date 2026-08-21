import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const policy = readFileSync(new URL("../policies/unslop.md", import.meta.url), "utf8")
  .replace(/\r\n?/g, "\n")
  .trim();

export const UNSLOP_INSTRUCTIONS = `UNSLOP MODE ACTIVE

Apply the full checklist to generated chat and persisted prose.

Preserve meaning, tone, exact code, commands, paths, quotes, citations, data, error text, and required formats. Repository style controls persisted text. Caveman controls chat length. Never invent facts or opinions, and do not add words merely to perform a voice.

${policy}`;

export default function unslopExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${UNSLOP_INSTRUCTIONS}`,
  }));
}
