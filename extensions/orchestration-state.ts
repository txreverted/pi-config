import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { RunHealth, RunLifecycle } from "./orchestration-core.ts";
import type { PiInvocation, UsageSummary } from "./subagents-core.ts";
import type {
  BuiltinWorkflowName,
  DeclarativeWorkflowSpec,
  WorkflowExecutionResult,
  WorkflowStepOutcome,
} from "./workflows-core.ts";

export const ORCHESTRATION_STATE_VERSION = 1;
export const MAX_PERSISTED_RUNS = 30;
export const RUN_RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_STATE_FILE_BYTES = 2 * 1024 * 1024;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export interface WorkflowOrigin {
  sessionId: string;
  sessionFile?: string;
}

export interface WorkflowHostConfig {
  version: 1;
  runId: string;
  runDir: string;
  statePath: string;
  cwd: string;
  origin: WorkflowOrigin;
  objective: string;
  paths: string[];
  builtinName?: BuiltinWorkflowName;
  spec?: DeclarativeWorkflowSpec;
  model?: string;
  modelReasoning?: boolean;
  invocation: PiInvocation;
  hasWriter: boolean;
  retryOf?: string;
}

export interface PersistedWorkflowRun {
  version: 1;
  kind: "workflow";
  runId: string;
  name: string;
  description: string;
  objectivePreview: string;
  cwd: string;
  origin: WorkflowOrigin;
  status: RunLifecycle;
  health: RunHealth;
  healthReason?: string;
  pid?: number;
  hostStartedAt?: number;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  updatedAt: number;
  lastActivityAt?: number;
  durationMs: number;
  steps: WorkflowStepOutcome[];
  output: string;
  error?: string;
  usage: UsageSummary;
  hasWriter: boolean;
  retryOf?: string;
  gitStatusBefore?: string;
  gitStatusAfter?: string;
  deliveredAt?: number;
}

export interface CreatedRunFiles {
  runDir: string;
  configPath: string;
  statePath: string;
}

export function orchestrationRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PI_CONFIG_ORCHESTRATION_DIR?.trim();
  return resolve(override || join(homedir(), ".pi", "agent", "orchestration-runs"));
}

export function createRunId(prefix = "run"): string {
  const cleanPrefix = prefix.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "run";
  return `${cleanPrefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function assertRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("Invalid orchestration run id");
}

export async function ensureOrchestrationRoot(root = orchestrationRoot()): Promise<string> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const metadata = await lstat(root);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Orchestration root must be a real private directory: ${root}`);
  }
  await chmod(root, 0o700);
  return root;
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const content = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(content) > MAX_STATE_FILE_BYTES) throw new Error(`Orchestration state exceeds ${MAX_STATE_FILE_BYTES} bytes`);
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function createWorkflowRunFiles(
  config: Omit<WorkflowHostConfig, "runDir" | "statePath">,
  initialState: PersistedWorkflowRun,
  root = orchestrationRoot(),
): Promise<CreatedRunFiles> {
  assertRunId(config.runId);
  await ensureOrchestrationRoot(root);
  const runDir = join(root, config.runId);
  await mkdir(runDir, { mode: 0o700 });
  await chmod(runDir, 0o700);
  const configPath = join(runDir, "config.json");
  const statePath = join(runDir, "state.json");
  await atomicWriteJson(configPath, { ...config, runDir, statePath });
  await atomicWriteJson(statePath, initialState);
  return { runDir, configPath, statePath };
}

async function readBoundedJson(path: string): Promise<unknown> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_STATE_FILE_BYTES) throw new Error(`Invalid orchestration state file: ${path}`);
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readWorkflowHostConfig(path: string): Promise<WorkflowHostConfig> {
  const configPath = resolve(path);
  if (basename(configPath) !== "config.json") throw new Error("Workflow host requires a canonical config.json path");
  const value = await readBoundedJson(configPath);
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1) {
    throw new Error("Unsupported workflow host configuration");
  }
  const config = value as WorkflowHostConfig;
  assertRunId(config.runId);
  const expectedRunDir = dirname(configPath);
  if (resolve(config.runDir) !== expectedRunDir || resolve(config.statePath) !== join(expectedRunDir, "state.json")) {
    throw new Error("Workflow state path does not match its private run directory");
  }
  if (config.builtinName === undefined && config.spec === undefined) throw new Error("Workflow host config has no workflow definition");
  if (config.builtinName !== undefined && config.spec !== undefined) throw new Error("Workflow host config has multiple workflow definitions");
  return config;
}

export async function readPersistedWorkflowRun(path: string): Promise<PersistedWorkflowRun> {
  const value = await readBoundedJson(path);
  if (!value || typeof value !== "object") throw new Error("Invalid persisted workflow run");
  const state = value as PersistedWorkflowRun;
  if (state.version !== ORCHESTRATION_STATE_VERSION || state.kind !== "workflow") {
    throw new Error("Unsupported persisted workflow run");
  }
  assertRunId(state.runId);
  return state;
}

export async function readRunById(runId: string, root = orchestrationRoot()): Promise<PersistedWorkflowRun | undefined> {
  assertRunId(runId);
  try {
    return await readPersistedWorkflowRun(join(root, runId, "state.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function listPersistedWorkflowRuns(root = orchestrationRoot()): Promise<PersistedWorkflowRun[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const states = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && RUN_ID_PATTERN.test(entry.name))
      .map(async (entry) => {
        try {
          return await readPersistedWorkflowRun(join(root, entry.name, "state.json"));
        } catch {
          return undefined;
        }
      }));
    return states
      .filter((state): state is PersistedWorkflowRun => state !== undefined)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function updatePersistedWorkflowRun(
  runId: string,
  update: (current: PersistedWorkflowRun) => PersistedWorkflowRun,
  root = orchestrationRoot(),
): Promise<PersistedWorkflowRun> {
  assertRunId(runId);
  const path = join(root, runId, "state.json");
  const current = await readPersistedWorkflowRun(path);
  const next = update(current);
  await atomicWriteJson(path, next);
  return next;
}

export async function cleanupPersistedRuns(
  root = orchestrationRoot(),
  now = Date.now(),
): Promise<void> {
  const runs = await listPersistedWorkflowRuns(root);
  const removable = runs.filter((run, index) => {
    const terminal = run.status === "completed" || run.status === "completed_with_warnings" || run.status === "failed" || run.status === "aborted" || run.status === "timed_out";
    return terminal && (index >= MAX_PERSISTED_RUNS || now - (run.endedAt ?? run.updatedAt) > RUN_RETENTION_MS);
  });
  await Promise.all(removable.map((run) => rm(join(root, run.runId), { recursive: true, force: true })));
}

export function resultToPersistedState(
  current: PersistedWorkflowRun,
  result: WorkflowExecutionResult,
  extra: { gitStatusBefore?: string; gitStatusAfter?: string } = {},
): PersistedWorkflowRun {
  return {
    ...current,
    status: result.status,
    health: result.status === "failed" ? "dead" : "healthy",
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    updatedAt: Date.now(),
    lastActivityAt: result.endedAt,
    durationMs: result.durationMs,
    steps: result.steps,
    output: result.output,
    usage: result.usage,
    ...(result.error ? { error: result.error } : {}),
    ...(extra.gitStatusBefore !== undefined ? { gitStatusBefore: extra.gitStatusBefore } : {}),
    ...(extra.gitStatusAfter !== undefined ? { gitStatusAfter: extra.gitStatusAfter } : {}),
  };
}
