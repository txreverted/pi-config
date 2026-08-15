import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  type AgentDefinition,
  type AgentName,
} from "../extensions/subagents-core.ts";

export const AGENT_NAMES = ["scout", "reviewer", "worker", "researcher", "synthesizer"] as const satisfies readonly AgentName[];

function prompt(name: AgentName): string {
  return readFileSync(fileURLToPath(new URL(`./prompts/${name}.md`, import.meta.url)), "utf8").trim();
}

export function createAgentRegistry(): ReadonlyMap<AgentName, AgentDefinition> {
  const webExtensionPath = fileURLToPath(new URL("../extensions/web.ts", import.meta.url));
  const readOnlyGitExtensionPath = fileURLToPath(new URL("../extensions/subagent-tools.ts", import.meta.url));
  const agents: AgentDefinition[] = [
    {
      name: "scout",
      description: "Map relevant code, dependencies, conventions, and likely change surfaces without editing files.",
      tools: ["read", "grep", "find", "ls", "git_status", "git_diff"],
      extensions: [readOnlyGitExtensionPath],
      prompt: prompt("scout"),
      thinking: "low",
      timeoutMs: 8 * 60_000,
      contextFiles: true,
    },
    {
      name: "reviewer",
      description: "Perform a fresh, evidence-based, read-only code review.",
      tools: ["read", "grep", "find", "ls", "git_status", "git_diff"],
      extensions: [readOnlyGitExtensionPath],
      prompt: prompt("reviewer"),
      thinking: "inherit",
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
      contextFiles: true,
    },
    {
      name: "worker",
      description: "Implement one bounded task in the current checkout. This is the only file-writing role.",
      tools: ["read", "bash", "edit", "write"],
      prompt: prompt("worker"),
      thinking: "inherit",
      timeoutMs: 25 * 60_000,
      contextFiles: true,
      writer: true,
    },
    {
      name: "researcher",
      description: "Research public sources using the hardened keyless web tools.",
      tools: ["web_search", "web_fetch"],
      extensions: [webExtensionPath],
      prompt: prompt("researcher"),
      thinking: "low",
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
      contextFiles: false,
    },
    {
      name: "synthesizer",
      description: "Reconcile delegated evidence into a concise, verified final report.",
      tools: ["read", "grep", "find", "ls", "git_status", "git_diff"],
      extensions: [readOnlyGitExtensionPath],
      prompt: prompt("synthesizer"),
      thinking: "inherit",
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
      contextFiles: true,
    },
  ];
  return new Map(agents.map((agent) => [agent.name, agent]));
}
