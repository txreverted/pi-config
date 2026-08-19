import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { AGENT_RESULT_LIMITS, validateAgentResultPayload } from "./core.ts";

const SAFE_READ_TOOLS = new Set(["read", "grep", "find", "ls", "git_diff", "agent_result"]);

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

function requestedPath(cwd: string, value: unknown): string {
  if (value === undefined) return cwd;
  if (typeof value !== "string" || !value || value.includes("\0")) throw new Error("Tool path is invalid");
  const cleaned = value.startsWith("@") ? value.slice(1) : value;
  return resolve(cwd, cleaned);
}

async function existingPath(workspace: string, cwd: string, value: unknown): Promise<void> {
  const target = await realpath(requestedPath(cwd, value));
  if (!isInside(workspace, target)) throw new Error("Tool path must remain inside the agent workspace");
}

async function writablePath(workspace: string, cwd: string, value: unknown): Promise<void> {
  const target = requestedPath(cwd, value);
  if (!isInside(workspace, target)) throw new Error("Write path must remain inside the agent worktree");
  const fromWorkspace = relative(workspace, target);
  if (fromWorkspace === ".git" || fromWorkspace.startsWith(`.git${sep}`)) throw new Error("Writes to Git metadata are denied");
  let current = target;
  while (true) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error("Writes through symlinks are denied");
      const actual = await realpath(current);
      if (!isInside(workspace, actual)) throw new Error("Write path must remain inside the agent worktree");
      if (current === target && info.isDirectory()) throw new Error("Write path must be a file");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw new Error("Write path has no existing parent");
      current = parent;
    }
  }
}

function currentToolBatch(ctx: ExtensionContext, toolCallId: string): string[] {
  for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { type?: unknown; message?: unknown };
    if (record.type !== "message" || !record.message || typeof record.message !== "object") continue;
    const message = record.message as Record<string, unknown>;
    if (message.role !== "assistant") continue;
    const content = Array.isArray(message.content) ? message.content : [];
    const calls = content.filter((item): item is { type: "toolCall"; id: string; name: string } =>
      Boolean(item && typeof item === "object" && (item as Record<string, unknown>).type === "toolCall" &&
        typeof (item as Record<string, unknown>).id === "string" && typeof (item as Record<string, unknown>).name === "string"));
    if (calls.some((call) => call.id === toolCallId)) return calls.map((call) => call.name);
  }
  return [];
}

export default function subagentChildExtension(pi: ExtensionAPI): void {
  if (process.env.PI_CONFIG_SUBAGENT_CHILD !== "1") return;
  const workspaceValue = process.env.PI_CONFIG_AGENT_WORKSPACE;
  if (!workspaceValue) throw new Error("Subagent workspace is unavailable");
  const workspace = resolve(workspaceValue);
  const cwd = resolve(process.env.PI_CONFIG_AGENT_CWD ?? process.cwd());
  if (!isInside(workspace, cwd)) throw new Error("Subagent cwd must remain inside its workspace");
  const writable = process.env.PI_CONFIG_AGENT_WRITABLE === "1";

  pi.registerTool({
    name: "agent_result",
    label: "Agent Result",
    description: "Return the bounded final delegated-task result. Call alone when finished or blocked.",
    parameters: Type.Object({
      status: StringEnum(["succeeded", "blocked"] as const),
      summary: Type.String({ minLength: 1, maxLength: AGENT_RESULT_LIMITS.summaryChars }),
      evidence: Type.Array(
        Type.String({ minLength: 1, maxLength: AGENT_RESULT_LIMITS.evidenceChars }),
        { maxItems: AGENT_RESULT_LIMITS.evidenceItems },
      ),
      question: Type.Optional(Type.String({ minLength: 1, maxLength: AGENT_RESULT_LIMITS.questionChars })),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    async execute(_id, params) {
      const result = validateAgentResultPayload(params);
      return {
        content: [{ type: "text", text: result.status === "blocked" ? `Blocked: ${result.question}` : result.summary }],
        details: { agentResult: result },
        terminate: true,
      };
    },
  });

  if (process.env.PI_CONFIG_AGENT_ROLE === "reviewer") {
    pi.registerTool({
      name: "git_diff",
      label: "Git Diff",
      description: "Read the current workspace Git diff without modifying it.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        const result = await pi.exec("git", ["--no-optional-locks", "--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--binary", "--", "."], {
          cwd,
          timeout: 30_000,
        });
        if (result.code !== 0) throw new Error(result.stderr || "git diff failed");
        const bounded = truncateHead(result.stdout, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
        return {
          content: [{ type: "text", text: bounded.content || "No changes." }],
          details: { truncated: bounded.truncated, totalBytes: bounded.totalBytes },
        };
      },
    });
  }

  pi.on("tool_call", async (event, ctx) => {
    try {
      if (event.toolName === "agent_result") {
        const batch = currentToolBatch(ctx, event.toolCallId);
        if (batch.length > 1) return { block: true, terminate: true, reason: "agent_result must be called alone" };
        return;
      }
      if (event.toolName === "edit" || event.toolName === "write") {
        if (!writable) return { block: true, reason: "This subagent role is read-only" };
        const input = event.input as Record<string, unknown>;
        await writablePath(workspace, cwd, input.path ?? input.file_path);
        return;
      }
      if (!SAFE_READ_TOOLS.has(event.toolName)) return { block: true, reason: `Tool '${event.toolName}' is unavailable to subagents` };
      if (event.toolName === "read" || event.toolName === "grep" || event.toolName === "find" || event.toolName === "ls") {
        const input = event.input as Record<string, unknown>;
        await existingPath(workspace, cwd, input.path ?? input.file_path ?? ".");
      }
    } catch (error) {
      return { block: true, reason: error instanceof Error ? error.message : "Subagent workspace policy denied the tool call" };
    }
  });

  pi.on("session_start", async () => {
    const info = await stat(workspace);
    if (!info.isDirectory()) throw new Error("Subagent workspace is not a directory");
  });
}
