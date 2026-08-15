import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AGENT_NAMES,
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  type AgentDefinition,
  type AgentName,
} from "../extensions/subagents-core.ts";

export { AGENT_NAMES };

function prompt(name: AgentName): string {
  return readFileSync(fileURLToPath(new URL(`./prompts/${name}.md`, import.meta.url)), "utf8").trim();
}

export function createAgentRegistry(): ReadonlyMap<AgentName, AgentDefinition> {
  const webExtensionPath = fileURLToPath(new URL("../extensions/web.ts", import.meta.url));
  const readOnlyGitExtensionPath = fileURLToPath(new URL("../extensions/subagent-tools.ts", import.meta.url));
  const agents: AgentDefinition[] = [
    {
      name: "scout",
      tools: ["read", "grep", "find", "ls", "git_status", "git_diff"],
      extensions: [readOnlyGitExtensionPath],
      prompt: prompt("scout"),
      thinking: "low",
      timeoutMs: 8 * 60_000,
      contextFiles: true,
      maxTurns: 16,
      maxToolCalls: 48,
      maxReportedTokens: 750_000,
      maxCostUsd: 1,
    },
    {
      name: "reviewer",
      tools: ["read", "grep", "find", "ls", "git_status", "git_diff"],
      extensions: [readOnlyGitExtensionPath],
      prompt: prompt("reviewer"),
      thinking: "high",
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
      contextFiles: true,
      maxTurns: 24,
      maxToolCalls: 96,
      maxReportedTokens: 2_000_000,
      maxCostUsd: 2,
    },
    {
      name: "worker",
      tools: ["read", "bash", "edit", "write"],
      prompt: prompt("worker"),
      thinking: "high",
      timeoutMs: 25 * 60_000,
      contextFiles: true,
      writer: true,
    },
    {
      name: "researcher",
      tools: ["web_search", "web_fetch"],
      extensions: [webExtensionPath],
      prompt: prompt("researcher"),
      thinking: "low",
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
      contextFiles: false,
      maxTurns: 16,
      maxToolCalls: 32,
      maxReportedTokens: 750_000,
      maxCostUsd: 1,
    },
    {
      name: "synthesizer",
      tools: ["read", "grep", "find", "ls", "git_status", "git_diff"],
      extensions: [readOnlyGitExtensionPath],
      prompt: prompt("synthesizer"),
      thinking: "high",
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
      contextFiles: true,
      maxTurns: 16,
      maxToolCalls: 48,
      maxReportedTokens: 1_000_000,
      maxCostUsd: 1.5,
    },
  ];
  return new Map(agents.map((agent) => [agent.name, agent]));
}
