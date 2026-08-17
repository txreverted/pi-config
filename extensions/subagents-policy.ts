import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { brokerRequest } from "./subagents-supervisor.ts";

const SAFE_TOOLS = new Set([
  "read", "grep", "find", "ls", "jq", "web_search", "web_fetch", "subagent", "get_subagent_result",
  "cancel_subagent", "list_agents", "send_agent_message", "task",
]);
const SECRET_ENV = /(?:^|_)(?:secret|token|key|password|passwd|auth|authorization|cookie|credential)(?:_|$)/i;

function inside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

export function stripChildCommandEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) =>
    !name.startsWith("PI_CONFIG_BROKER_") && name !== "PI_CONFIG_AGENT_ID" && !SECRET_ENV.test(name),
  ));
}

async function existingPath(root: string, cwd: string, value: unknown): Promise<void> {
  if (typeof value !== "string" || !value) throw new Error("Tool path is required");
  const path = await realpath(resolve(cwd, value));
  if (!inside(root, path)) throw new Error("Tool path must remain inside the agent worktree");
}

async function writablePath(root: string, cwd: string, value: unknown): Promise<void> {
  if (typeof value !== "string" || !value) throw new Error("Tool path is required");
  const target = resolve(cwd, value);
  if (!inside(root, target)) throw new Error("Write path must remain inside the agent worktree");
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error("Writes through symlinks are denied");
    const actual = await realpath(target);
    if (!inside(root, actual)) throw new Error("Write path must remain inside the agent worktree");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = await realpath(dirname(target));
    if (!inside(root, parent) || !(await stat(parent)).isDirectory()) throw new Error("Write parent must remain inside the agent worktree");
  }
}

export default function writableAgentPolicy(pi: ExtensionAPI): void {
  const workspaceValue = process.env.PI_CONFIG_AGENT_WORKTREE;
  if (process.env.PI_CONFIG_SUBAGENT_CHILD !== "1" || !workspaceValue) return;
  const workspace = resolve(workspaceValue);
  const cwd = resolve(process.env.PI_CONFIG_AGENT_CWD ?? process.cwd());
  if (!inside(workspace, cwd)) throw new Error("Writable agent cwd must remain inside its worktree");

  const bash = createBashToolDefinition(cwd, {
    exposeSessionEnvironment: false,
    spawnHook: ({ command, cwd, env }) => ({ command, cwd, env: stripChildCommandEnvironment(env) }),
  });
  pi.registerTool(bash);

  pi.on("tool_call", async (event) => {
    try {
      const args = structuredClone(event.input) as Record<string, unknown>;
      if (event.toolName === "bash" || event.toolName === "edit" || event.toolName === "write") {
        if (event.toolName === "edit" || event.toolName === "write") await writablePath(workspace, cwd, args.path ?? args.file_path);
        const result = await brokerRequest({
          action: "permission", agentId: process.env.PI_CONFIG_AGENT_ID,
          toolCallId: event.toolCallId, toolName: event.toolName, args, workspace,
        });
        if (!result || typeof result !== "object" || (result as { approved?: unknown }).approved !== true) {
          return { block: true, reason: "Human approval denied" };
        }
        return;
      }
      if (!SAFE_TOOLS.has(event.toolName)) return { block: true, reason: `Tool '${event.toolName}' is not allowed by writable-agent policy` };
      if (["read", "grep", "find", "ls"].includes(event.toolName)) await existingPath(workspace, cwd, args.path ?? ".");
      if (event.toolName === "jq") {
        const files = args.files;
        if (files !== undefined && !Array.isArray(files)) return { block: true, reason: "Invalid jq file list" };
        for (const file of (files as unknown[] | undefined) ?? []) await existingPath(workspace, cwd, file);
      }
    } catch (error) {
      return { block: true, reason: error instanceof Error ? error.message : "Writable-agent policy denied the tool call" };
    }
  });
}
