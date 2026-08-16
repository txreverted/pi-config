import { readFile, writeFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { safeDisplayLine, safeDisplayText } from "./text-safety.ts";
import { normalizeDisplayText } from "./ui-core.ts";
import {
  removeBoundedOutput,
  runBoundedProcess,
  type BoundedProcessResult,
} from "./tools-core.ts";

const JQ_OUTPUT_HARD_LIMIT_BYTES = 10 * 1024 * 1024;

interface OutputDetails {
  exitCode: number;
  truncation?: TruncationResult;
  fullOutputPath?: string;
  outputLimitReached?: number;
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
        name: Type.String({
          pattern: "^[A-Za-z_][A-Za-z0-9_]*$",
          description: "jq variable name without the leading $",
        }),
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
}, { additionalProperties: false });

function normalizePath(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path;
}

function processError(result: BoundedProcessResult): Error {
  const diagnostic = safeDisplayLine(result.stderr || result.stdout, 1_000);
  return new Error(`jq exited with code ${result.code}${diagnostic ? `: ${diagnostic}` : ""}`);
}

function appendStderr(stdout: string, stderr: string): string {
  if (!stderr) return stdout;
  if (!stdout) return stderr;
  return `${stdout.replace(/\n$/, "")}\n\n[stderr]\n${stderr}`;
}

async function sanitizeRetainedOutput(path: string): Promise<void> {
  const content = await readFile(path, "utf8");
  await writeFile(path, safeDisplayText(content), "utf8");
}

function appendTruncationNotice(
  text: string,
  result: BoundedProcessResult,
  retainedOutputs: Set<string>,
): string {
  if (!result.truncation || !result.fullOutputPath) return text;
  retainedOutputs.add(result.fullOutputPath);
  const truncation = result.truncation;
  const savedOutput = result.outputLimitReached
    ? `Captured stdout saved to: ${safeDisplayLine(result.fullOutputPath)}`
    : `Full stdout saved to: ${safeDisplayLine(result.fullOutputPath)}`;
  const hardLimit = result.outputLimitReached
    ? ` Processing stopped after reaching the ${formatSize(result.outputLimitReached)} hard output limit.`
    : "";
  const notice =
    `[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} captured lines ` +
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)} captured). ` +
    `${savedOutput}.${hardLimit}]`;
  return text ? `${text}\n\n${notice}` : notice;
}

export default function toolsExtension(pi: ExtensionAPI): void {
  const retainedOutputs = new Set<string>();

  pi.on("session_start", () => {
    const active = pi.getActiveTools();
    if (active.includes("grep") && active.includes("find")) return;
    pi.setActiveTools([...new Set([...active, "grep", "find"])]);
  });

  pi.registerTool({
    name: "jq",
    label: "jq",
    description: `Query or transform JSON with jq. Provide input, files, or nullInput. Execution is capped at two minutes and ${formatSize(JQ_OUTPUT_HARD_LIMIT_BYTES)} of stdout. Output is streamed with bounded memory and truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; sanitized captured stdout is saved to a mode-0600 temporary file when truncated.`,
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
        maxOutputBytes: JQ_OUTPUT_HARD_LIMIT_BYTES,
      });
      if (result.code !== 0 && !result.outputLimitReached) {
        if (result.fullOutputPath) await removeBoundedOutput(result.fullOutputPath);
        throw processError(result);
      }
      if (result.fullOutputPath) await sanitizeRetainedOutput(result.fullOutputPath);

      let text = safeDisplayText(appendStderr(result.stdout, result.stderr)) || "jq produced no output";
      text = appendTruncationNotice(text, result, retainedOutputs);
      return {
        content: [{ type: "text", text }],
        details: {
          exitCode: result.code,
          truncation: result.truncation,
          fullOutputPath: result.fullOutputPath,
          outputLimitReached: result.outputLimitReached,
        } satisfies OutputDetails,
      };
    },
    renderResult(result) {
      const content = result.content[0]?.type === "text" ? result.content[0].text : "(no output)";
      return new Text(normalizeDisplayText(content), 0, 0);
    },
  });

  pi.on("session_shutdown", async () => {
    const outputs = [...retainedOutputs];
    retainedOutputs.clear();
    await Promise.all(outputs.map((path) => removeBoundedOutput(path).catch(() => {})));
  });
}
