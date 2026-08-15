import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWorkflowRunFiles,
  ensureOrchestrationRoot,
  readPersistedWorkflowRun,
  readWorkflowHostConfig,
} from "../extensions/orchestration-state.ts";
import { emptyUsage } from "../extensions/subagents-core.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));
const host = fileURLToPath(new URL("../extensions/workflow-host.ts", import.meta.url));

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

test("private workflow host executes a declarative run and atomically persists completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-orchestration-state-"));
  const cwd = await mkdtemp(join(tmpdir(), "pi-orchestration-cwd-"));
  const runId = "host-test-run";
  const queuedAt = Date.now();
  const spec = {
    version: 1,
    name: "host-smoke",
    outputStep: "scan",
    steps: [{ id: "scan", agent: "scout", task: "Inspect the fixture" }],
  };
  const initial = {
    version: 1,
    kind: "workflow",
    runId,
    name: spec.name,
    description: "test",
    objectivePreview: "smoke",
    cwd,
    origin: { sessionId: "test-session" },
    status: "queued",
    health: "healthy",
    queuedAt,
    updatedAt: queuedAt,
    durationMs: 0,
    steps: [{
      id: "scan", agent: "scout", status: "queued", health: "healthy", output: "", usage: emptyUsage(),
      durationMs: 0, attempt: 0, maxAttempts: 1, turns: 0, toolCalls: 0, recentEvents: [], queuedAt,
    }],
    output: "",
    usage: emptyUsage(),
    hasWriter: false,
  };
  try {
    const files = await createWorkflowRunFiles({
      version: 1,
      runId,
      cwd,
      origin: { sessionId: "test-session" },
      objective: "Smoke test",
      paths: [],
      spec,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      hasWriter: false,
    }, initial, root);
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
    assert.equal(completed.steps[0].status, "completed");
    assert.ok(completed.startedAt >= completed.queuedAt);
    assert.ok(completed.endedAt >= completed.startedAt);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});
