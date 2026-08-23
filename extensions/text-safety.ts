import { stripTerminalSequences } from "@earendil-works/pi-tui";

const UNSAFE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;
const TERMINAL_STRING = /(?:\u001b[\]PX^_]|[\u0090\u0098\u009d\u009e\u009f])[\s\S]*?(?:\u0007|\u001b\\|\u009c|$)/g;
const TERMINAL_CSI = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
const TERMINAL_ESCAPE = /\u001b[ -/]*[0-~]/g;

export function safeDisplayText(value: unknown): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  return stripTerminalSequences(text
    .replace(TERMINAL_STRING, "")
    .replace(TERMINAL_CSI, "")
    .replace(TERMINAL_ESCAPE, ""))
    .replace(/\r/g, "")
    .replace(UNSAFE_TEXT, "");
}

export function normalizeDisplayText(value: unknown): string {
  const lines: string[] = [];
  let previousBlank = false;
  for (const line of safeDisplayText(value).split("\n")) {
    const blank = line.trim().length === 0;
    if (blank && previousBlank) continue;
    lines.push(blank ? "" : line);
    previousBlank = blank;
  }
  return lines.join("\n");
}

export function safeDisplayLine(value: unknown, maxChars?: number): string {
  const text = safeDisplayText(value).replace(/\s+/g, " ").trim();
  if (maxChars === undefined) return text;
  if (!Number.isSafeInteger(maxChars) || maxChars < 1) throw new Error("maxChars must be a positive integer");
  const characters = Array.from(text);
  if (characters.length <= maxChars) return text;
  return maxChars <= 3 ? ".".repeat(maxChars) : `${characters.slice(0, maxChars - 3).join("")}...`;
}
