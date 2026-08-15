import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  withFileMutationQueue,
  type ExtensionAPI,
  type FindToolDetails,
  type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface ProcessResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface OutputDetails {
  exitCode: number;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

function normalizePath(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path;
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
  input?: string,
): Promise<ProcessResult> {
  return new Promise((resolveProcess, rejectProcess) => {
    if (signal?.aborted) {
      rejectProcess(new Error("Operation aborted"));
      return;
    }

    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let aborted = false;

    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const reject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectProcess(error);
    };
    const onAbort = () => {
      aborted = true;
      child.kill("SIGTERM");
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => reject(error));
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (aborted) {
        rejectProcess(new Error("Operation aborted"));
        return;
      }

      resolveProcess({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code: code ?? 1,
      });
    });

    child.stdin.on("error", () => {
      // The process may close stdin early after reporting its own useful error.
    });
    child.stdin.end(input);
  });
}

function processError(command: string, result: ProcessResult): Error {
  const message = (result.stderr || result.stdout).trim();
  return new Error(`${command} exited with code ${result.code}${message ? `: ${message}` : ""}`);
}

function successfulOutput(result: ProcessResult): string {
  if (!result.stderr) return result.stdout;
  if (!result.stdout) return result.stderr;
  return `${result.stdout.replace(/\n$/, "")}\n\n[stderr]\n${result.stderr}`;
}

async function truncateOutput(
  toolName: string,
  output: string,
): Promise<{ text: string; truncation?: TruncationResult; fullOutputPath?: string }> {
  const truncation = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) return { text: truncation.content };

  const tempDir = await mkdtemp(join(tmpdir(), `pi-${toolName}-`));
  const fullOutputPath = join(tempDir, "output.txt");
  await withFileMutationQueue(fullOutputPath, () => writeFile(fullOutputPath, output, "utf8"));

  const notice =
    `[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines ` +
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
    `Full output saved to: ${fullOutputPath}]`;

  return {
    text: truncation.content ? `${truncation.content}\n\n${notice}` : notice,
    truncation,
    fullOutputPath,
  };
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
    Type.Boolean({ description: "Include .git and node_modules directories (default: false)" }),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum results (default: 1000)" })),
});

export default function toolsExtension(pi: ExtensionAPI) {
  // Canonical names intentionally replace same-named built-in tools, including Pi's built-in find.
  pi.registerTool({
    name: "jq",
    label: "jq",
    description: `Query or transform JSON with jq. Provide input, files, or nullInput. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; complete truncated output is saved to a temporary file.`,
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
      for (const { name, value } of params.variables ?? []) {
        args.push("--arg", name, value);
      }
      args.push("--", params.filter);
      args.push(...(params.files ?? []).map(normalizePath));

      const result = await runProcess("jq", args, ctx.cwd, signal, params.input);
      if (result.code !== 0) throw processError("jq", result);

      const output = successfulOutput(result);
      if (!output) {
        return {
          content: [{ type: "text", text: "jq produced no output" }],
          details: { exitCode: result.code } satisfies OutputDetails,
        };
      }

      const formatted = await truncateOutput("jq", output);
      return {
        content: [{ type: "text", text: formatted.text }],
        details: {
          exitCode: result.code,
          truncation: formatted.truncation,
          fullOutputPath: formatted.fullOutputPath,
        } satisfies OutputDetails,
      };
    },
  });

  pi.registerTool({
    name: "find",
    label: "find",
    description: `Find files or directories with the system find command. Matches a name glob, or a path glob when pattern contains '/'. Skips .git and node_modules unless includeIgnored is true. Output is limited to 1000 results by default and truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Find files or directories by name or path glob",
    promptGuidelines: ["Use find to locate files or directories by glob; use rg to search their contents."],
    parameters: findSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const searchPath = resolve(ctx.cwd, normalizePath(params.path ?? "."));
      const args = [searchPath];

      if (params.maxDepth !== undefined) args.push("-maxdepth", String(params.maxDepth));
      if (!params.includeIgnored) {
        args.push("(", "-name", ".git", "-o", "-name", "node_modules", ")", "-prune", "-o");
      }

      const resultType = params.type ?? "file";
      if (resultType === "file") args.push("-type", "f");
      if (resultType === "directory") args.push("-type", "d");

      if (params.pattern.includes("/")) {
        const pathPattern = params.pattern.replace(/^\.\//, "");
        args.push("-path", join(searchPath, pathPattern));
      } else {
        args.push("-name", params.pattern);
      }
      args.push("-print");

      const result = await runProcess("find", args, ctx.cwd, signal);
      if (result.code !== 0) throw processError("find", result);

      const matches = result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((path) => relative(searchPath, path).split(sep).join("/") || ".")
        .sort((a, b) => a.localeCompare(b));

      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: "No files found matching pattern" }],
          details: undefined,
        };
      }

      const limit = params.limit ?? 1000;
      const resultLimitReached = matches.length > limit;
      const output = matches.slice(0, limit).join("\n");
      const formatted = await truncateOutput("find", output);
      const details: FindToolDetails = {};
      const notices: string[] = [];

      if (resultLimitReached) {
        details.resultLimitReached = limit;
        notices.push(`${limit} results limit reached; refine pattern or increase limit`);
      }
      if (formatted.truncation) details.truncation = formatted.truncation;

      return {
        content: [
          {
            type: "text",
            text: notices.length > 0 ? `${formatted.text}\n\n[${notices.join(". ")}]` : formatted.text,
          },
        ],
        details: Object.keys(details).length > 0 ? details : undefined,
      };
    },
  });

  pi.registerTool({
    name: "rg",
    label: "rg",
    description: `Search file contents with ripgrep. Respects ignore files by default and reports file paths with line numbers. Exit code 1 means no matches. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; complete truncated output is saved to a temporary file.`,
    promptSnippet: "Search file contents quickly with ripgrep",
    promptGuidelines: ["Use rg for content search instead of invoking ripgrep through bash."],
    parameters: rgSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const args = ["--line-number", "--no-heading", "--color=never"];
      if (params.glob) args.push("--glob", params.glob);
      if (params.ignoreCase) args.push("--ignore-case");
      if (params.literal) args.push("--fixed-strings");
      if (params.hidden) args.push("--hidden");
      if (params.context !== undefined) args.push("--context", String(params.context));
      if (params.maxCount !== undefined) args.push("--max-count", String(params.maxCount));
      args.push("--", params.pattern, normalizePath(params.path ?? "."));

      const result = await runProcess("rg", args, ctx.cwd, signal);
      if (result.code === 1) {
        return {
          content: [{ type: "text", text: "No matches found" }],
          details: { exitCode: result.code } satisfies OutputDetails,
        };
      }
      if (result.code !== 0) throw processError("rg", result);

      const formatted = await truncateOutput("rg", successfulOutput(result));
      return {
        content: [{ type: "text", text: formatted.text }],
        details: {
          exitCode: result.code,
          truncation: formatted.truncation,
          fullOutputPath: formatted.fullOutputPath,
        } satisfies OutputDetails,
      };
    },
  });
}
