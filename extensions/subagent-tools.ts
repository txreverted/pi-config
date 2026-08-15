import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatSize } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  DEFAULT_PROCESS_MAX_OUTPUT_BYTES,
  removeBoundedOutput,
  runBoundedProcess,
  type BoundedProcessResult,
} from "./tools-core.ts";

function resultText(result: BoundedProcessResult): string {
  let text = result.stdout || result.stderr || "(no output)";
  if (result.truncation && result.fullOutputPath) {
    text +=
      `\n\n[Output truncated: showing ${result.truncation.outputLines} of ${result.truncation.totalLines} lines ` +
      `(${formatSize(result.truncation.outputBytes)} of ${formatSize(result.truncation.totalBytes)}). ` +
      `${result.outputLimitReached ? "Captured" : "Full"} stdout saved to: ${result.fullOutputPath}` +
      `${result.outputLimitReached ? `; process stopped at ${formatSize(result.outputLimitReached)}` : ""}]`;
  }
  return text;
}

async function runGit(args: string[], cwd: string, signal?: AbortSignal): Promise<BoundedProcessResult> {
  const result = await runBoundedProcess("git", ["--no-optional-locks", ...args], {
    cwd,
    signal,
    timeoutMs: 30_000,
    tempPrefix: "pi-subagent-git",
  });
  if (result.code !== 0 && !result.outputLimitReached) {
    if (result.fullOutputPath) await removeBoundedOutput(result.fullOutputPath);
    throw new Error(`git exited with code ${result.code}: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

export default function subagentToolsExtension(pi: ExtensionAPI) {
  const retainedOutputs = new Set<string>();
  const retain = (result: BoundedProcessResult) => {
    if (result.fullOutputPath) retainedOutputs.add(result.fullOutputPath);
    return result;
  };

  pi.registerTool({
    name: "git_status",
    label: "git status",
    description: `Show the current repository branch and concise working-tree status without modifying the repository. Output is capped at ${formatSize(DEFAULT_PROCESS_MAX_OUTPUT_BYTES)}.`,
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      const result = retain(await runGit(["status", "--short", "--branch"], ctx.cwd, signal));
      return {
        content: [{ type: "text", text: resultText(result) }],
        details: { exitCode: result.code, truncation: result.truncation, fullOutputPath: result.fullOutputPath },
      };
    },
  });

  pi.registerTool({
    name: "git_diff",
    label: "git diff",
    description: `Inspect unstaged or staged working-tree changes without modifying the repository. Optional paths are passed after '--'. Output is capped at ${formatSize(DEFAULT_PROCESS_MAX_OUTPUT_BYTES)}.`,
    parameters: Type.Object({
      staged: Type.Optional(Type.Boolean({ description: "Show staged changes instead of unstaged changes" })),
      paths: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 4_096 }), {
        maxItems: 32,
        description: "Optional repository-relative paths to restrict the diff",
      })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const args = ["diff", "--no-ext-diff", "--no-textconv"];
      if (params.staged) args.push("--cached");
      if (params.paths?.length) args.push("--", ...params.paths);
      const result = retain(await runGit(args, ctx.cwd, signal));
      return {
        content: [{ type: "text", text: resultText(result) }],
        details: { exitCode: result.code, truncation: result.truncation, fullOutputPath: result.fullOutputPath },
      };
    },
  });

  pi.on("session_shutdown", async () => {
    const outputs = [...retainedOutputs];
    retainedOutputs.clear();
    await Promise.all(outputs.map((path) => removeBoundedOutput(path).catch(() => {})));
  });
}
