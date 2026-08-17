import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AGENT_NAMES,
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
  const bridgeExtension = fileURLToPath(new URL("../extensions/subagents-bridge.ts", import.meta.url));
  const taskExtension = fileURLToPath(new URL("../extensions/task.ts", import.meta.url));
  const policyExtension = fileURLToPath(new URL("../extensions/subagents-policy.ts", import.meta.url));
  const teamTools = ["subagent", "get_subagent_result", "cancel_subagent", "list_agents", "send_agent_message", "task"];
  const agents: AgentDefinition[] = [
    {
      name: "Explore",
      tools: ["read", "grep", "find", "ls", "task"],
      extensions: [taskExtension],
      prompt: prompt("Explore"),
      thinking: "low",
      contextFiles: true,
      mutatesWorkspace: false,
    },
    {
      name: "general-purpose",
      tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "jq", "web_search", "web_fetch", ...teamTools],
      extensions: [toolsExtension, webExtension, bridgeExtension, taskExtension, policyExtension],
      prompt: prompt("general-purpose"),
      thinking: "medium",
      contextFiles: true,
      mutatesWorkspace: true,
    },
    {
      name: "reviewer",
      tools: ["read", "grep", "find", "ls", "git_status", "git_diff", "task"],
      extensions: [gitExtension, taskExtension],
      prompt: prompt("reviewer"),
      thinking: "high",
      contextFiles: true,
      mutatesWorkspace: false,
    },
    {
      name: "researcher",
      tools: ["web_search", "web_fetch", "task"],
      extensions: [webExtension, taskExtension],
      prompt: prompt("researcher"),
      thinking: "low",
      contextFiles: false,
      mutatesWorkspace: false,
    },
    {
      name: "worker",
      tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "jq", "web_search", "web_fetch", ...teamTools],
      extensions: [toolsExtension, webExtension, bridgeExtension, taskExtension, policyExtension],
      prompt: prompt("worker"),
      thinking: "medium",
      contextFiles: true,
      mutatesWorkspace: true,
    },
  ];
  return new Map(agents.map((agent) => [agent.name, agent]));
}
