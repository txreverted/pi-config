import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { removeBoundedOutput, runBoundedProcess } from "./tools-core.ts";

interface OutputDetails {
  exitCode: number;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

function normalizePath(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path;
}

function processError(command: string, code: number, stdout: string, stderr: string): Error {
  const message = (stderr || stdout).trim();
  return new Error(`${command} exited with code ${code}${message ? `: ${message}` : ""}`);
}

const jqSchema = Type.Object({
  filter: Type.String({ description: "jq filter to evaluate, for example '.items[] | .name'" }),
  input: Type.Optional(Type.String({ description: "JSON or JSON Lines to pass on stdin" })),
  files: Type.Optional(
    Type.Array(Type.String({ description: "JSON file path, relative to the working directory or absolute" }), {
      minItems: 1,
    }),
  ),
  variables: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String({ description: "jq variable name without the leading $" }),
        value: Type.String({ description: "String value passed with --arg" }),
      }),
      { description: "String variables passed to jq with --arg" },
    ),
  ),
  rawOutput: Type.Optional(Type.Boolean({ description: "Use raw string output (-r)" })),
  compactOutput: Type.Optional(Type.Boolean({ description: "Use compact JSON output (-c)" })),
  slurp: Type.Optional(Type.Boolean({ description: "Read all inputs into an array (-s)" })),
  nullInput: Type.Optional(Type.Boolean({ description: "Run the filter once with null input (-n)" })),
  sortKeys: Type.Optional(Type.Boolean({ description: "Sort object keys in output (-S)" })),
});

export default function toolsExtension(pi: ExtensionAPI) {
  const retainedOutputs = new Set<string>();

  pi.registerTool({
    name: "jq",
    label: "jq",
    description: `Query or transform JSON with jq. Provide input, files, or nullInput. Execution is capped at two minutes. Output is streamed with bounded memory and truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; complete truncated stdout is saved to a mode-0600 temporary file.`,
    promptSnippet: "Query and transform JSON with jq filters",
    promptGuidelines: ["Use jq for structured JSON queries and transformations instead of parsing JSON with shell text tools."],
    parameters: jqSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (params.input !== undefined && params.files !== undefined) {
        throw new Error("jq accepts either input or files, not both");
      }
      if (params.nullInput && (params.input !== undefined || params.files !== undefined)) {
        throw new Error("jq nullInput cannot be combined with input or files");
      }
      if (params.input === undefined && params.files === undefined && !params.nullInput) {
        throw new Error("jq requires input, files, or nullInput=true");
      }

      const args: string[] = [];
      if (params.rawOutput) args.push("--raw-output");
      if (params.compactOutput) args.push("--compact-output");
      if (params.slurp) args.push("--slurp");
      if (params.nullInput) args.push("--null-input");
      if (params.sortKeys) args.push("--sort-keys");
      for (const { name, value } of params.variables ?? []) args.push("--arg", name, value);
      args.push("--", params.filter, ...(params.files ?? []).map(normalizePath));

      const result = await runBoundedProcess("jq", args, {
        cwd: ctx.cwd,
        signal,
        input: params.input,
        tempPrefix: "pi-jq",
      });
      if (result.code !== 0) throw processError("jq", result.code, result.stdout, result.stderr);

      let text = result.stdout;
      if (result.stderr) {
        const separator = text ? "\n\n[stderr]\n" : "";
        text += `${separator}${result.stderr}`;
      }
      if (!text) text = "jq produced no output";

      if (result.truncation && result.fullOutputPath) {
        retainedOutputs.add(result.fullOutputPath);
        const truncation = result.truncation;
        text +=
          `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines ` +
          `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
          `Full stdout saved to: ${result.fullOutputPath}]`;
      }

      return {
        content: [{ type: "text", text }],
        details: {
          exitCode: result.code,
          truncation: result.truncation,
          fullOutputPath: result.fullOutputPath,
        } satisfies OutputDetails,
      };
    },
  });

  pi.on("session_shutdown", async () => {
    const outputs = [...retainedOutputs];
    retainedOutputs.clear();
    await Promise.all(outputs.map((path) => removeBoundedOutput(path).catch(() => {})));
  });
}
