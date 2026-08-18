export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const AGENT_ROLES = ["explorer", "worker", "reviewer"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export interface AgentRoleDefinition {
  role: AgentRole;
  tools: readonly string[];
  thinking: ThinkingLevel;
  mutatesWorkspace: boolean;
  prompt: string;
}

const RETURN = `Finish by calling agent_result alone. Use status blocked only when parent input is required. Give concise evidence with exact paths and symbols. Do not address the user.`;

export const ROLE_DEFINITIONS: Readonly<Record<AgentRole, AgentRoleDefinition>> = {
  explorer: {
    role: "explorer",
    tools: ["read", "grep", "find", "ls", "agent_result"],
    thinking: "low",
    mutatesWorkspace: false,
    prompt: `You are a fast read-only codebase explorer. Trace the assigned area far enough to give the parent reliable paths, symbols, data flow, conventions, risks, and unknowns. Prefer direct evidence over proposals. Never modify files. ${RETURN}`,
  },
  worker: {
    role: "worker",
    tools: ["read", "grep", "find", "ls", "edit", "write", "agent_result"],
    thinking: "medium",
    mutatesWorkspace: true,
    prompt: `You are an isolated implementation worker. Make only the assigned change, follow repository instructions, stay inside the declared write scope, and keep the diff minimal. Do not commit. The parent will inspect the patch and run final checks. ${RETURN}`,
  },
  reviewer: {
    role: "reviewer",
    tools: ["read", "grep", "find", "ls", "git_diff", "agent_result"],
    thinking: "high",
    mutatesWorkspace: false,
    prompt: `You are a fresh-context read-only reviewer. Review only the assigned angle. Report concrete correctness, security, compatibility, test, or simplicity findings with evidence. Do not repeat unsupported concerns and never modify files. ${RETURN}`,
  },
};
