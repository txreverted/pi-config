import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  RUN_HEALTHS,
  RUN_LIFECYCLES,
  isTerminalLifecycle,
  type RunHealth,
  type RunLifecycle,
} from "./orchestration-core.ts";
import {
  AGENT_NAMES,
  THINKING_LEVELS,
  type PiInvocation,
  type UsageSummary,
} from "./subagents-core.ts";
import type {
  BuiltinWorkflowName,
  WorkflowExecutionResult,
  WorkflowStepOutcome,
} from "./workflows-core.ts";

export const ORCHESTRATION_STATE_VERSION = 1;
export const MAX_PERSISTED_RUNS = 30;
export const RUN_RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_STATE_FILE_BYTES = 2 * 1024 * 1024;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const BUILTIN_WORKFLOW_NAMES = new Set<BuiltinWorkflowName>(["review", "implement-review", "research"]);

export interface WorkflowOrigin {
  sessionId: string;
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
  builtinName: BuiltinWorkflowName;
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
  objectivePreview: string;
  cwd: string;
  origin: WorkflowOrigin;
  status: RunLifecycle;
  health: RunHealth;
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

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function numberValue(value: unknown, label: string, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be a non-negative${integer ? " integer" : " number"}`);
  }
  return value;
}

function optionalString(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== "string") throw new Error(`${label} must be a string`);
}

function optionalNumber(value: unknown, label: string, integer = false): void {
  if (value !== undefined) numberValue(value, label, integer);
}

function assertOrigin(value: unknown, label: string): asserts value is WorkflowOrigin {
  const origin = record(value, label);
  stringValue(origin.sessionId, `${label}.sessionId`);
}

function assertUsage(value: unknown, label: string): asserts value is UsageSummary {
  const usage = record(value, label);
  for (const field of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
    numberValue(usage[field], `${label}.${field}`);
  }
  optionalNumber(usage.cacheWrite1h, `${label}.cacheWrite1h`);
  optionalNumber(usage.reasoning, `${label}.reasoning`);
  const cost = record(usage.cost, `${label}.cost`);
  for (const field of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
    numberValue(cost[field], `${label}.cost.${field}`);
  }
}

function assertStep(value: unknown, index: number): asserts value is WorkflowStepOutcome {
  const label = `Orchestration step ${index + 1}`;
  const step = record(value, label);
  stringValue(step.id, `${label}.id`);
  if (!AGENT_NAMES.includes(step.agent as typeof AGENT_NAMES[number])) throw new Error(`${label}.agent is invalid`);
  if (!RUN_LIFECYCLES.includes(step.status as RunLifecycle)) throw new Error(`${label}.status is invalid`);
  if (!RUN_HEALTHS.includes(step.health as RunHealth)) throw new Error(`${label}.health is invalid`);
  if (typeof step.output !== "string") throw new Error(`${label}.output must be a string`);
  assertUsage(step.usage, `${label}.usage`);
  for (const field of ["durationMs", "attempt", "maxAttempts", "turns", "toolCalls", "queuedAt"] as const) {
    numberValue(step[field], `${label}.${field}`, ["attempt", "maxAttempts", "turns", "toolCalls"].includes(field));
  }
  for (const field of ["startedAt", "endedAt", "spawnedAt", "firstProtocolAt", "lastActivityAt", "currentToolStartedAt"] as const) {
    optionalNumber(step[field], `${label}.${field}`);
  }
  for (const field of ["phase", "error", "currentTool", "inputHash"] as const) optionalString(step[field], `${label}.${field}`);
  if (step.thinking !== undefined && !THINKING_LEVELS.includes(step.thinking as typeof THINKING_LEVELS[number])) {
    throw new Error(`${label}.thinking is invalid`);
  }
  if (step.restored !== undefined && typeof step.restored !== "boolean") throw new Error(`${label}.restored must be boolean`);
  if (!Array.isArray(step.recentEvents)) throw new Error(`${label}.recentEvents must be an array`);
  for (const [eventIndex, eventValue] of step.recentEvents.entries()) {
    const event = record(eventValue, `${label}.recentEvents[${eventIndex}]`);
    numberValue(event.at, `${label}.recentEvents[${eventIndex}].at`);
    stringValue(event.type, `${label}.recentEvents[${eventIndex}].type`);
    optionalString(event.label, `${label}.recentEvents[${eventIndex}].label`);
  }
}

function assertPersistedWorkflowRun(value: unknown): asserts value is PersistedWorkflowRun {
  const state = record(value, "Persisted workflow run");
  if (state.version !== ORCHESTRATION_STATE_VERSION || state.kind !== "workflow") {
    throw new Error("Unsupported persisted workflow run");
  }
  assertRunId(stringValue(state.runId, "Persisted workflow run.runId"));
  for (const field of ["name", "objectivePreview", "cwd", "output"] as const) {
    if (typeof state[field] !== "string") throw new Error(`Persisted workflow run.${field} must be a string`);
  }
  assertOrigin(state.origin, "Persisted workflow run.origin");
  if (!RUN_LIFECYCLES.includes(state.status as RunLifecycle)) throw new Error("Persisted workflow run.status is invalid");
  if (!RUN_HEALTHS.includes(state.health as RunHealth)) throw new Error("Persisted workflow run.health is invalid");
  for (const field of ["queuedAt", "updatedAt", "durationMs"] as const) numberValue(state[field], `Persisted workflow run.${field}`);
  for (const field of ["pid", "hostStartedAt", "startedAt", "endedAt", "lastActivityAt", "deliveredAt"] as const) {
    optionalNumber(state[field], `Persisted workflow run.${field}`, field === "pid");
  }
  for (const field of ["error", "retryOf", "gitStatusBefore", "gitStatusAfter"] as const) optionalString(state[field], `Persisted workflow run.${field}`);
  if (typeof state.hasWriter !== "boolean") throw new Error("Persisted workflow run.hasWriter must be boolean");
  if (!Array.isArray(state.steps)) throw new Error("Persisted workflow run.steps must be an array");
  state.steps.forEach(assertStep);
  assertUsage(state.usage, "Persisted workflow run.usage");
  if (state.retryOf !== undefined) assertRunId(state.retryOf as string);
}

function assertWorkflowHostConfig(value: unknown): asserts value is WorkflowHostConfig {
  const config = record(value, "Workflow host configuration");
  if (config.version !== 1) throw new Error("Unsupported workflow host configuration");
  assertRunId(stringValue(config.runId, "Workflow host configuration.runId"));
  for (const field of ["runDir", "statePath", "cwd", "objective"] as const) {
    if (typeof config[field] !== "string") throw new Error(`Workflow host configuration.${field} must be a string`);
  }
  assertOrigin(config.origin, "Workflow host configuration.origin");
  if (!Array.isArray(config.paths) || config.paths.some((path) => typeof path !== "string")) {
    throw new Error("Workflow host configuration.paths must be a string array");
  }
  if (!BUILTIN_WORKFLOW_NAMES.has(config.builtinName as BuiltinWorkflowName)) {
    throw new Error("Workflow host configuration has an unknown built-in workflow");
  }
  optionalString(config.model, "Workflow host configuration.model");
  if (config.modelReasoning !== undefined && typeof config.modelReasoning !== "boolean") {
    throw new Error("Workflow host configuration.modelReasoning must be boolean");
  }
  const invocation = record(config.invocation, "Workflow host configuration.invocation");
  stringValue(invocation.command, "Workflow host configuration.invocation.command");
  if (!Array.isArray(invocation.argsPrefix) || invocation.argsPrefix.some((arg) => typeof arg !== "string")) {
    throw new Error("Workflow host configuration.invocation.argsPrefix must be a string array");
  }
  if (typeof config.hasWriter !== "boolean") throw new Error("Workflow host configuration.hasWriter must be boolean");
  optionalString(config.retryOf, "Workflow host configuration.retryOf");
  if (config.retryOf !== undefined) assertRunId(config.retryOf as string);
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
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_STATE_FILE_BYTES) {
    throw new Error(`Invalid orchestration state file: ${path}`);
  }
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readWorkflowHostConfig(path: string): Promise<WorkflowHostConfig> {
  const configPath = resolve(path);
  if (basename(configPath) !== "config.json") throw new Error("Workflow host requires a canonical config.json path");
  const value = await readBoundedJson(configPath);
  assertWorkflowHostConfig(value);
  const expectedRunDir = dirname(configPath);
  if (basename(expectedRunDir) !== value.runId) throw new Error("Workflow run id does not match its private directory");
  if (resolve(value.runDir) !== expectedRunDir || resolve(value.statePath) !== join(expectedRunDir, "state.json")) {
    throw new Error("Workflow state path does not match its private run directory");
  }
  return value;
}

export async function readPersistedWorkflowRun(path: string): Promise<PersistedWorkflowRun> {
  const statePath = resolve(path);
  const value = await readBoundedJson(statePath);
  assertPersistedWorkflowRun(value);
  if (basename(statePath) === "state.json" && basename(dirname(statePath)) !== value.runId) {
    throw new Error("Workflow run id does not match its private directory");
  }
  return value;
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
  assertPersistedWorkflowRun(next);
  await atomicWriteJson(path, next);
  return next;
}

export async function cleanupPersistedRuns(root = orchestrationRoot(), now = Date.now()): Promise<void> {
  const runs = await listPersistedWorkflowRuns(root);
  const removable = runs.filter((run, index) =>
    isTerminalLifecycle(run.status) && (index >= MAX_PERSISTED_RUNS || now - (run.endedAt ?? run.updatedAt) > RUN_RETENTION_MS)
  );
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
