import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AGENT_NAMES, type AgentDefinition, type AgentName } from "../extensions/subagents-core.ts";

export { AGENT_NAMES };

function prompt(name: AgentName): string {
  return readFileSync(fileURLToPath(new URL(`./prompts/${name}.md`, import.meta.url)), "utf8").trim();
}

export function createAgentRegistry(): ReadonlyMap<AgentName, AgentDefinition> {
  const toolsExtension = fileURLToPath(new URL("../extensions/tools.ts", import.meta.url));
  const webExtension = fileURLToPath(new URL("../extensions/web.ts", import.meta.url));
  const gitExtension = fileURLToPath(new URL("../extensions/subagent-tools.ts", import.meta.url));
  const policyExtension = fileURLToPath(new URL("../extensions/subagents-policy.ts", import.meta.url));
  const agents: AgentDefinition[] = [
    {
      name: "Explore",
      tools: ["read", "grep", "find", "ls"],
      extensions: [policyExtension],
      prompt: prompt("Explore"),
      thinking: "low",
      contextFiles: true,
      mutatesWorkspace: false,
    },
    {
      name: "reviewer",
      tools: ["read", "grep", "find", "ls", "git_status", "git_diff"],
      extensions: [gitExtension, policyExtension],
      prompt: prompt("reviewer"),
      thinking: "high",
      contextFiles: true,
      mutatesWorkspace: false,
    },
    {
      name: "researcher",
      tools: ["web_search", "web_fetch"],
      extensions: [webExtension],
      prompt: prompt("researcher"),
      thinking: "low",
      contextFiles: false,
      mutatesWorkspace: false,
    },
    {
      name: "worker",
      tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "jq", "web_search", "web_fetch"],
      extensions: [toolsExtension, webExtension, policyExtension],
      prompt: prompt("worker"),
      thinking: "medium",
      contextFiles: true,
      mutatesWorkspace: true,
    },
  ];
  return new Map(agents.map((agent) => [agent.name, agent]));
}
