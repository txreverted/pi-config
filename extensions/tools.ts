import { access } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, FindToolDetails } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  ensureSearchExecutable,
  removeBoundedOutput,
  runBoundedProcess,
  type BoundedProcessResult,
} from "./tools-core.ts";

const SEARCH_OUTPUT_HARD_LIMIT_BYTES = 10 * 1024 * 1024;

interface OutputDetails {
  exitCode: number;
  truncation?: TruncationResult;
  fullOutputPath?: string;
  outputLimitReached?: number;
}

function normalizePath(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path;
}

export function displayPath(path: string): string {
  return path.replace(/[\u0000-\u001f\u007f]/g, (character) => {
    if (character === "\n") return String.raw`\n`;
    if (character === "\r") return String.raw`\r`;
    if (character === "\t") return String.raw`\t`;
    return `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`;
  });
}

export function parseNulRecords(stdout: string): string[] {
  const records = stdout.split("\0");
  if (!stdout.endsWith("\0")) records.pop();
  return records.filter((path) => path.length > 0);
}

function processError(command: string, result: BoundedProcessResult): Error {
  const message = (result.stderr || result.stdout).trim();
  return new Error(`${command} exited with code ${result.code}${message ? `: ${message}` : ""}`);
}

function appendStderr(stdout: string, stderr: string): string {
  if (!stderr) return stdout;
  if (!stdout) return stderr;
  return `${stdout.replace(/\n$/, "")}\n\n[stderr]\n${stderr}`;
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
    ? `Captured stdout saved to: ${result.fullOutputPath}`
    : `Full stdout saved to: ${result.fullOutputPath}`;
  const hardLimit = result.outputLimitReached
    ? ` Search stopped after reaching the ${formatSize(result.outputLimitReached)} hard output limit.`
    : "";
  const notice =
    `[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} captured lines ` +
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)} captured). ` +
    `${savedOutput}.${hardLimit}]`;
  return text ? `${text}\n\n${notice}` : notice;
}

async function isInsideGitRepository(searchPath: string): Promise<boolean> {
  for (let current = searchPath; ; ) {
    try {
      await access(join(current, ".git"));
      return true;
    } catch {
      const parent = dirname(current);
      if (parent === current) return false;
      current = parent;
    }
  }
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

const rgSchema = Type.Object({
  pattern: Type.String({ description: "Regular expression to search for" }),
  path: Type.Optional(Type.String({ description: "File or directory to search (default: current directory)" })),
  glob: Type.Optional(Type.String({ description: "Include or exclude file glob, for example '*.ts' or '!dist/**'" })),
  ignoreCase: Type.Optional(Type.Boolean({ description: "Search case-insensitively" })),
  literal: Type.Optional(Type.Boolean({ description: "Treat pattern as a literal string instead of a regex" })),
  hidden: Type.Optional(Type.Boolean({ description: "Search hidden files and directories" })),
  context: Type.Optional(Type.Integer({ minimum: 0, description: "Context lines before and after each match" })),
  maxCount: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum matches per file" })),
});

const findSchema = Type.Object({
  pattern: Type.String({ description: "File name or relative path glob, for example '*.ts' or 'src/*.test.ts'" }),
  path: Type.Optional(Type.String({ description: "Directory to search (default: current directory)" })),
  type: Type.Optional(
    StringEnum(["file", "directory", "any"] as const, {
      description: "Kind of result to return (default: file)",
    }),
  ),
  maxDepth: Type.Optional(Type.Integer({ minimum: 0, description: "Maximum directory depth to search" })),
  includeIgnored: Type.Optional(
    Type.Boolean({ description: "Include ignored files, .git, and node_modules (default: false)" }),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000, description: "Maximum results (default: 1000)" })),
});

export default function toolsExtension(pi: ExtensionAPI) {
  const retainedOutputs = new Set<string>();
  const executablePromises: Partial<Record<"fd" | "rg", Promise<string>>> = {};

  const getSearchExecutable = async (tool: "fd" | "rg", signal?: AbortSignal): Promise<string> => {
    if (signal?.aborted) throw new Error("Operation aborted");
    let pending = executablePromises[tool];
    if (!pending) {
      pending = ensureSearchExecutable(tool);
      executablePromises[tool] = pending;
      void pending.catch(() => {
        if (executablePromises[tool] === pending) delete executablePromises[tool];
      });
    }
    if (!signal) return pending;

    return new Promise<string>((resolveExecutable, rejectExecutable) => {
      const onAbort = () => rejectExecutable(new Error("Operation aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      void pending.then(
        (executable) => {
          signal.removeEventListener("abort", onAbort);
          resolveExecutable(executable);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          rejectExecutable(error);
        },
      );
    });
  };

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
      if (result.code !== 0) {
        if (result.fullOutputPath) await removeBoundedOutput(result.fullOutputPath);
        throw processError("jq", result);
      }

      let text = appendStderr(result.stdout, result.stderr) || "jq produced no output";
      text = appendTruncationNotice(text, result, retainedOutputs);

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

  pi.registerTool({
    name: "find",
    label: "find (fd)",
    description: `Find files or directories with fd. Matches name or relative-path globs, respects ignore files by default, and skips .git and node_modules. Results default to 1000; displayed output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}, and search stops at ${formatSize(SEARCH_OUTPUT_HARD_LIMIT_BYTES)} of stdout. fd is installed automatically on first use. This extension overrides Pi's built-in find tool.`,
    promptSnippet: "Find files or directories quickly with fd",
    promptGuidelines: ["Use find to locate files or directories by glob; use rg to search their contents."],
    parameters: findSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const executable = await getSearchExecutable("fd", signal);
      const searchPath = resolve(ctx.cwd, normalizePath(params.path ?? "."));
      const limit = params.limit ?? 1000;
      const args = ["--glob", "--color=never", "--hidden", "--print0", "--max-results", String(limit + 1)];

      if (!params.includeIgnored) {
        args.push("--exclude", ".git", "--exclude", "node_modules");
        if (!(await isInsideGitRepository(searchPath))) args.push("--no-require-git");
      } else {
        args.push("--no-ignore");
      }
      if (params.maxDepth !== undefined) args.push("--max-depth", String(params.maxDepth));
      if ((params.type ?? "file") === "file") args.push("--type", "f");
      if (params.type === "directory") args.push("--type", "d");

      let pattern = params.pattern.replace(/^\.\//, "");
      if (pattern.includes("/")) {
        args.push("--full-path");
        if (!pattern.startsWith("/") && !pattern.startsWith("**/") && pattern !== "**") pattern = `**/${pattern}`;
        if (process.platform === "win32") pattern = pattern.replaceAll("/", String.raw`[/\\]`);
      }
      args.push("--", pattern, searchPath);

      const result = await runBoundedProcess(executable, args, {
        cwd: ctx.cwd,
        signal,
        tempPrefix: "pi-find",
        maxOutputBytes: SEARCH_OUTPUT_HARD_LIMIT_BYTES,
      });
      if (result.code !== 0 && !result.outputLimitReached) {
        if (result.fullOutputPath) await removeBoundedOutput(result.fullOutputPath);
        throw processError("fd", result);
      }

      const matches = parseNulRecords(result.stdout)
        .map((path) => {
          const absolutePath = isAbsolute(path) ? path : resolve(ctx.cwd, path);
          return relative(searchPath, absolutePath).split(sep).join("/") || ".";
        })
        .sort((a, b) => a.localeCompare(b));

      if (matches.length === 0) {
        return { content: [{ type: "text", text: "No files found matching pattern" }], details: undefined };
      }

      const details: FindToolDetails = {};
      const notices: string[] = [];
      if (matches.length > limit) {
        details.resultLimitReached = limit;
        notices.push(`${limit} results limit reached; refine pattern or increase limit`);
      }
      if (result.truncation) details.truncation = result.truncation;

      let text = matches.slice(0, limit).map(displayPath).join("\n");
      text = appendTruncationNotice(text, result, retainedOutputs);
      if (notices.length > 0) text += `\n\n[${notices.join(". ")}]`;

      return {
        content: [{ type: "text", text }],
        details: Object.keys(details).length > 0 ? details : undefined,
      };
    },
  });

  pi.registerTool({
    name: "rg",
    label: "rg",
    description: `Search file contents directly with ripgrep. Respects ignore files by default and reports paths with line numbers. Execution is capped at two minutes; displayed output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}, and search stops at ${formatSize(SEARCH_OUTPUT_HARD_LIMIT_BYTES)} of stdout. Captured truncated stdout is saved to a mode-0600 temporary file. ripgrep is installed automatically on first use. This tool replaces Pi's built-in grep tool in the active set.`,
    promptSnippet: "Search file contents quickly with ripgrep",
    promptGuidelines: ["Use rg for content search instead of grep or invoking ripgrep through bash."],
    parameters: rgSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const executable = await getSearchExecutable("rg", signal);
      const args = ["--line-number", "--no-heading", "--with-filename", "--color=never"];
      if (params.glob) args.push("--glob", params.glob);
      if (params.ignoreCase) args.push("--ignore-case");
      if (params.literal) args.push("--fixed-strings");
      if (params.hidden) args.push("--hidden");
      if (params.context !== undefined) args.push("--context", String(params.context));
      if (params.maxCount !== undefined) args.push("--max-count", String(params.maxCount));
      args.push("--", params.pattern, normalizePath(params.path ?? "."));

      const result = await runBoundedProcess(executable, args, {
        cwd: ctx.cwd,
        signal,
        tempPrefix: "pi-rg",
        maxOutputBytes: SEARCH_OUTPUT_HARD_LIMIT_BYTES,
      });
      if (result.code === 1 && !result.outputLimitReached) {
        if (result.fullOutputPath) await removeBoundedOutput(result.fullOutputPath);
        return {
          content: [{ type: "text", text: "No matches found" }],
          details: { exitCode: result.code } satisfies OutputDetails,
        };
      }
      if (result.code !== 0 && !result.outputLimitReached) {
        if (result.fullOutputPath) await removeBoundedOutput(result.fullOutputPath);
        throw processError("rg", result);
      }

      let text = appendStderr(result.stdout, result.stderr) || "No matches found";
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
  });

  pi.on("session_start", () => {
    const active = pi.getActiveTools();
    if (!active.includes("grep")) return;
    pi.setActiveTools([...new Set([...active.filter((name) => name !== "grep"), "rg"])]);
  });

  pi.on("session_shutdown", async () => {
    const outputs = [...retainedOutputs];
    retainedOutputs.clear();
    await Promise.all(outputs.map((path) => removeBoundedOutput(path).catch(() => {})));
  });
}
