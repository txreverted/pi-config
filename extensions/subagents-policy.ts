import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { lstat, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SAFE_TOOLS = new Set([
  "read", "grep", "find", "ls", "jq", "web_search", "web_fetch", "subagent", "get_subagent_result",
  "cancel_subagent", "list_agents", "send_agent_message", "task", "git_status", "git_diff",
]);
const COMMAND_ENV = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC",
  "TMPDIR", "TMP", "TEMP", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "TZ",
  "TERM", "COLORTERM", "NO_COLOR", "FORCE_COLOR",
]);

function inside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

export function stripChildCommandEnvironment(env: NodeJS.ProcessEnv, platform = process.platform): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) =>
    COMMAND_ENV.has(platform === "win32" ? name.toUpperCase() : name),
  ));
}

function toolPath(cwd: string, value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Tool path is required");
  let path = value.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  if (path.startsWith("@")) path = path.slice(1);
  if (path === "~") path = homedir();
  else if (path.startsWith("~/") || (process.platform === "win32" && path.startsWith("~\\"))) path = join(homedir(), path.slice(2));
  else if (/^file:\/\//.test(path)) path = fileURLToPath(path);
  return resolve(cwd, path);
}

async function existingPath(root: string, cwd: string, value: unknown): Promise<void> {
  const path = await realpath(toolPath(cwd, value));
  if (!inside(root, path)) throw new Error("Tool path must remain inside the agent workspace");
}

async function writablePath(root: string, cwd: string, value: unknown): Promise<void> {
  const target = toolPath(cwd, value);
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

export default function agentWorkspacePolicy(pi: ExtensionAPI): void {
  const worktreeValue = process.env.PI_CONFIG_AGENT_WORKTREE;
  const workspaceValue = worktreeValue ?? process.env.PI_CONFIG_AGENT_WORKSPACE;
  if (process.env.PI_CONFIG_SUBAGENT_CHILD !== "1" || !workspaceValue) return;
  const workspace = resolve(workspaceValue);
  const cwd = resolve(process.env.PI_CONFIG_AGENT_CWD ?? process.cwd());
  if (!inside(workspace, cwd)) throw new Error("Agent cwd must remain inside its workspace");

  if (worktreeValue) {
    const bash = createBashToolDefinition(cwd, {
      exposeSessionEnvironment: false,
      spawnHook: ({ command, cwd, env }) => ({ command, cwd, env: stripChildCommandEnvironment(env) }),
    });
    pi.registerTool(bash);
  }

  pi.on("tool_call", async (event) => {
    try {
      const args = structuredClone(event.input) as Record<string, unknown>;
      if (worktreeValue && (event.toolName === "bash" || event.toolName === "edit" || event.toolName === "write")) {
        if (event.toolName === "edit" || event.toolName === "write") await writablePath(workspace, cwd, args.path ?? args.file_path);
        return;
      }
      if (!SAFE_TOOLS.has(event.toolName)) return { block: true, reason: `Tool '${event.toolName}' is not allowed by agent workspace policy` };
      if (["read", "grep", "find", "ls"].includes(event.toolName)) await existingPath(workspace, cwd, args.path ?? ".");
      if (event.toolName === "jq") {
        const files = args.files;
        if (files !== undefined && !Array.isArray(files)) return { block: true, reason: "Invalid jq file list" };
        for (const file of (files as unknown[] | undefined) ?? []) await existingPath(workspace, cwd, file);
      }
    } catch (error) {
      return { block: true, reason: error instanceof Error ? error.message : "Agent workspace policy denied the tool call" };
    }
  });
}
