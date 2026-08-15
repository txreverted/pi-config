import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWorkflowRunFiles,
  ensureOrchestrationRoot,
  listPersistedWorkflowRuns,
  readPersistedWorkflowRun,
  readWorkflowHostConfig,
} from "../extensions/orchestration-state.ts";
import { emptyUsage } from "../extensions/subagents-core.ts";
import { createWorkflowRegistry } from "../subagents/workflows-registry.ts";
import { ThrottledStateWriter } from "../extensions/workflow-host.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));
const host = fileURLToPath(new URL("../extensions/workflow-host.ts", import.meta.url));

function initialState(runId, cwd, queuedAt, definition) {
  return {
    version: 1,
    kind: "workflow",
    runId,
    name: definition.name,
    objectivePreview: "smoke",
    cwd,
    origin: { sessionId: "test-session" },
    status: "queued",
    health: "healthy",
    queuedAt,
    updatedAt: queuedAt,
    durationMs: 0,
    steps: definition.steps.map((step) => ({
      id: step.id,
      agent: step.agent,
      ...(step.phase ? { phase: step.phase } : {}),
      status: "queued",
      health: "healthy",
      output: "",
      usage: emptyUsage(),
      durationMs: 0,
      attempt: 0,
      maxAttempts: 1,
      turns: 0,
      toolCalls: 0,
      recentEvents: [],
      queuedAt,
    })),
    output: "",
    usage: emptyUsage(),
    hasWriter: false,
  };
}

test("orchestration state rejects a symlinked root", async () => {
  const parent = await mkdtemp(join(tmpdir(), "pi-orchestration-symlink-"));
  const target = await mkdtemp(join(tmpdir(), "pi-orchestration-target-"));
  const root = join(parent, "runs");
  try {
    await symlink(target, root);
    await assert.rejects(() => ensureOrchestrationRoot(root), /real private directory/);
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test("persisted state validates its full runtime shape and lists only valid records", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-orchestration-validation-"));
  const invalidDir = join(root, "invalid-run");
  try {
    await mkdir(invalidDir);
    const invalidPath = join(invalidDir, "state.json");
    await writeFile(invalidPath, JSON.stringify({ version: 1, kind: "workflow", runId: "invalid-run" }));
    await assert.rejects(() => readPersistedWorkflowRun(invalidPath), /name|steps|objectivePreview/);
    assert.deepEqual(await listPersistedWorkflowRuns(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("throttled state writer reports asynchronous persistence failure immediately", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-orchestration-writer-failure-"));
  const target = join(root, "state-target");
  const definition = createWorkflowRegistry().get("review");
  assert.ok(definition);
  await mkdir(target);
  let reported;
  const writer = new ThrottledStateWriter(
    target,
    initialState("writer-failure", root, Date.now(), definition),
    (error) => { reported = error; },
  );
  try {
    writer.update((state) => ({ ...state, updatedAt: Date.now() }), true);
    await assert.rejects(() => writer.flush());
    assert.ok(reported instanceof Error);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("private workflow host executes a built-in run and atomically persists completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-orchestration-state-"));
  const cwd = await mkdtemp(join(tmpdir(), "pi-orchestration-cwd-"));
  const runId = "host-test-run";
  const queuedAt = Date.now();
  const definition = createWorkflowRegistry().get("review");
  assert.ok(definition);
  try {
    const files = await createWorkflowRunFiles({
      version: 1,
      runId,
      cwd,
      origin: { sessionId: "test-session" },
      objective: "Smoke test",
      paths: [],
      builtinName: "review",
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      hasWriter: false,
    }, initialState(runId, cwd, queuedAt, definition), root);
    assert.equal((await stat(files.runDir)).mode & 0o777, 0o700);
    assert.equal((await stat(files.configPath)).mode & 0o777, 0o600);
    assert.equal((await stat(files.statePath)).mode & 0o777, 0o600);
    assert.equal((await readWorkflowHostConfig(files.configPath)).runId, runId);

    const exit = await new Promise((resolveExit, rejectExit) => {
      const child = spawn(process.execPath, ["--experimental-strip-types", host, files.configPath], {
        cwd,
        shell: false,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      child.once("error", rejectExit);
      child.once("close", (code) => code === 0 ? resolveExit(code) : rejectExit(new Error(stderr || `host exited ${code}`)));
    });
    assert.equal(exit, 0);
    assert.equal((await stat(join(files.runDir, "lease"))).mode & 0o777, 0o600);
    const completed = await readPersistedWorkflowRun(files.statePath);
    assert.equal(completed.status, "completed");
    assert.equal(completed.output, "fixture completed");
    assert.equal(completed.steps.length, 4);
    assert.ok(completed.steps.every((step) => step.status === "completed"));
    assert.ok(completed.startedAt >= completed.queuedAt);
    assert.ok(completed.endedAt >= completed.startedAt);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});
