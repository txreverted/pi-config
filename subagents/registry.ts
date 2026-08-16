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
  const toolsExtension = fileURLToPath(new URL("../extensions/tools.ts", import.meta.url));
  const webExtension = fileURLToPath(new URL("../extensions/web.ts", import.meta.url));
  const gitExtension = fileURLToPath(new URL("../extensions/subagent-tools.ts", import.meta.url));
  const agents: AgentDefinition[] = [
    {
      name: "reviewer",
      tools: ["read", "grep", "find", "ls", "git_status", "git_diff"],
      extensions: [gitExtension],
      prompt: prompt("reviewer"),
      thinking: "high",
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
      contextFiles: true,
      mutatesWorkspace: false,
      maxTurns: 24,
      maxToolCalls: 96,
      maxReportedTokens: 2_000_000,
      maxCostUsd: 2,
    },
    {
      name: "researcher",
      tools: ["web_search", "web_fetch"],
      extensions: [webExtension],
      prompt: prompt("researcher"),
      thinking: "low",
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
      contextFiles: false,
      mutatesWorkspace: false,
      maxTurns: 16,
      maxToolCalls: 32,
      maxReportedTokens: 750_000,
      maxCostUsd: 1,
    },
    {
      name: "worker",
      tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "jq", "rg", "web_search", "web_fetch"],
      extensions: [toolsExtension, webExtension],
      prompt: prompt("worker"),
      thinking: "medium",
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
      contextFiles: true,
      mutatesWorkspace: true,
      maxTurns: 32,
      maxToolCalls: 128,
      maxReportedTokens: 2_000_000,
      maxCostUsd: 3,
    },
  ];
  return new Map(agents.map((agent) => [agent.name, agent]));
}
