import { readFile, stat, writeFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { normalizeDisplayText, safeDisplayLine, safeDisplayText } from "./text-safety.ts";
import {
  removeBoundedOutput,
  runBoundedProcess,
  type BoundedProcessResult,
} from "./tools-core.ts";

const JQ_OUTPUT_HARD_LIMIT_BYTES = 10 * 1024 * 1024;
const JQ_RETAINED_OUTPUT_LIMIT_BYTES = 50 * 1024 * 1024;
const JQ_RETAINED_OUTPUT_LIMIT_FILES = 10;
const COMBINED_TRUNCATION_NOTICE = "[Combined jq output truncated to stay within Pi's tool output limits.]";
const JQ_ENVIRONMENT_KEYS = new Set([
  "PATH", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "LC_MESSAGES", "TZ",
  "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT",
]);

interface OutputDetails {
  exitCode: number;
  truncation?: TruncationResult;
  fullOutputPath?: string;
  outputLimitReached?: number;
  evictedRetainedOutputs?: number;
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

function processError(result: BoundedProcessResult): Error {
  const diagnostic = safeDisplayLine(result.stderr || result.stdout, 1_000);
  return new Error(`jq exited with code ${result.code}${diagnostic ? `: ${diagnostic}` : ""}`);
}

function appendStderr(stdout: string, stderr: string): string {
  if (!stderr) return stdout;
  if (!stdout) return stderr;
  return `${stdout.replace(/\n$/, "")}\n\n[stderr]\n${stderr}`;
}

export async function sanitizeRetainedOutput(path: string): Promise<void> {
  try {
    const content = await readFile(path, "utf8");
    await writeFile(path, safeDisplayText(content), "utf8");
  } catch (error) {
    await removeBoundedOutput(path).catch(() => undefined);
    throw error;
  }
}

function jqEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment).filter(([name, value]) =>
    value !== undefined && JQ_ENVIRONMENT_KEYS.has(process.platform === "win32" ? name.toUpperCase() : name),
  ));
}

function processNotices(result: BoundedProcessResult, evictedRetainedOutputs: number): string[] {
  const notices: string[] = [];
  if (result.truncation && result.fullOutputPath) {
    const truncation = result.truncation;
    const savedOutput = result.outputLimitReached
      ? `Captured stdout saved to: ${safeDisplayLine(result.fullOutputPath)}`
      : `Full stdout saved to: ${safeDisplayLine(result.fullOutputPath)}`;
    notices.push(`[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} captured lines ` +
      `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)} captured). ${savedOutput}.]`);
  }
  if (result.outputLimitReached) {
    notices.push(`[Processing stopped after reaching the ${formatSize(result.outputLimitReached)} combined stdout/stderr hard limit.]`);
  }
  if (evictedRetainedOutputs > 0) {
    notices.push(`[Evicted ${evictedRetainedOutputs} older retained jq output file(s) to enforce session limits.]`);
  }
  return notices;
}

function boundedJqOutput(result: BoundedProcessResult, evictedRetainedOutputs: number): string {
  const output = safeDisplayText(appendStderr(result.stdout, result.stderr)) || "jq produced no output";
  const notices = processNotices(result, evictedRetainedOutputs).join("\n");
  const complete = notices ? `${output}\n\n${notices}` : output;
  if (Buffer.byteLength(complete, "utf8") <= DEFAULT_MAX_BYTES && complete.split("\n").length <= DEFAULT_MAX_LINES) {
    return complete;
  }

  const footer = `${notices ? `\n\n${notices}` : ""}\n\n${COMBINED_TRUNCATION_NOTICE}`;
  const truncated = truncateHead(output, {
    maxBytes: DEFAULT_MAX_BYTES - Buffer.byteLength(footer, "utf8"),
    maxLines: DEFAULT_MAX_LINES - footer.split("\n").length,
  });
  return `${truncated.content}${footer}`;
}

export async function retainBoundedOutput(
  retainedOutputs: Map<string, number>,
  path: string,
  size: number,
  maximumFiles: number,
  maximumBytes: number,
): Promise<number> {
  retainedOutputs.set(path, size);
  let totalBytes = [...retainedOutputs.values()].reduce((total, outputSize) => total + outputSize, 0);
  let evicted = 0;
  while (retainedOutputs.size > maximumFiles || totalBytes > maximumBytes) {
    const oldest = retainedOutputs.entries().next().value as [string, number] | undefined;
    if (!oldest) break;
    await removeBoundedOutput(oldest[0]);
    retainedOutputs.delete(oldest[0]);
    totalBytes -= oldest[1];
    evicted++;
  }
  return evicted;
}

export default function toolsExtension(pi: ExtensionAPI): void {
  const retainedOutputs = new Map<string, number>();

  pi.on("session_start", () => {
    const active = pi.getActiveTools();
    if (active.includes("grep") && active.includes("find")) return;
    pi.setActiveTools([...new Set([...active, "grep", "find"])]);
  });

  pi.registerTool({
    name: "jq",
    label: "jq",
    description: `Query or transform JSON with jq. Provide input, files, or nullInput. Execution is capped at two minutes and ${formatSize(JQ_OUTPUT_HARD_LIMIT_BYTES)} of combined stdout/stderr. Output is streamed with bounded memory and truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; up to ${JQ_RETAINED_OUTPUT_LIMIT_FILES} sanitized mode-0600 output files totaling ${formatSize(JQ_RETAINED_OUTPUT_LIMIT_BYTES)} are retained per session.`,
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
      args.push("--", params.filter, ...(params.files ?? []));

      const result = await runBoundedProcess("jq", args, {
        cwd: ctx.cwd,
        signal,
        input: params.input,
        tempPrefix: "pi-jq",
        maxOutputBytes: JQ_OUTPUT_HARD_LIMIT_BYTES,
        env: jqEnvironment(),
      });
      if (result.code !== 0 && !result.outputLimitReached) {
        if (result.fullOutputPath) await removeBoundedOutput(result.fullOutputPath);
        throw processError(result);
      }
      let evictedRetainedOutputs = 0;
      if (result.fullOutputPath) {
        await sanitizeRetainedOutput(result.fullOutputPath);
        evictedRetainedOutputs = await retainBoundedOutput(
          retainedOutputs,
          result.fullOutputPath,
          (await stat(result.fullOutputPath)).size,
          JQ_RETAINED_OUTPUT_LIMIT_FILES,
          JQ_RETAINED_OUTPUT_LIMIT_BYTES,
        );
      }

      return {
        content: [{ type: "text", text: boundedJqOutput(result, evictedRetainedOutputs) }],
        details: {
          exitCode: result.code,
          truncation: result.truncation,
          fullOutputPath: result.fullOutputPath,
          outputLimitReached: result.outputLimitReached,
          evictedRetainedOutputs: evictedRetainedOutputs || undefined,
        } satisfies OutputDetails,
      };
    },
    renderResult(result) {
      const content = result.content[0]?.type === "text" ? result.content[0].text : "(no output)";
      return new Text(normalizeDisplayText(content), 0, 0);
    },
  });

  pi.on("session_shutdown", async () => {
    const outputs = [...retainedOutputs.keys()];
    retainedOutputs.clear();
    await Promise.all(outputs.map((path) => removeBoundedOutput(path).catch(() => {})));
  });
}
