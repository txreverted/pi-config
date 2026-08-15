import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { visibleWidth } from "@earendil-works/pi-tui";
import { OrchestrationRuntime, formatCompactRunLine } from "../extensions/orchestration-runtime.ts";
import { compileDeclarativeWorkflowSpec } from "../extensions/workflows-core.ts";
import { readRunById } from "../extensions/orchestration-state.ts";
import { createWorkflowRegistry } from "../subagents/workflows-registry.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));

function fakePi() {
  const handlers = new Map();
  const messages = [];
  return {
    handlers,
    messages,
    tools: new Map(),
    commands: new Map(),
    on(event, handler) { handlers.set(event, handler); },
    registerCommand(name, command) { this.commands.set(name, command); },
    registerTool(tool) { this.tools.set(tool.name, tool); },
    sendMessage(message, options) { messages.push({ message, options }); },
  };
}

function fakeContext(cwd) {
  return {
    mode: "print",
    hasUI: false,
    cwd,
    model: undefined,
    thinkingLevel: "off",
    ui: {
      notify() {}, setWidget() {}, confirm: async () => false, select: async () => undefined,
    },
    sessionManager: {
      getSessionId: () => "runtime-test-session",
      getSessionFile: () => undefined,
      getEntries: () => [],
    },
    isIdle: () => true,
  };
}

async function waitForState(runId, accept, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readRunById(runId);
    if (state && accept(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Run ${runId} did not reach the expected state within ${timeoutMs}ms`);
}

async function waitForTerminal(runId, timeoutMs = 3_000) {
  return await waitForState(runId, (state) => ["completed", "completed_with_warnings", "failed", "aborted", "timed_out"].includes(state.status), timeoutMs);
}

test("compact run rows retain timers at narrow and wide terminal widths", () => {
  const run = {
    name: "a-very-long-background-workflow-name",
    status: "running",
    health: "quiet",
    queuedAt: 0,
    startedAt: 0,
  };
  for (const width of [40, 80, 120]) {
    const line = formatCompactRunLine(run, width, 61_000);
    assert.ok(visibleWidth(line) <= width);
    assert.match(line, /1m01s/);
  }
});

test("background runtime survives the tool return and delivers completion exactly once", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-orchestration-runtime-"));
  const cwd = await mkdtemp(join(tmpdir(), "pi-orchestration-runtime-cwd-"));
  const previousRoot = process.env.PI_CONFIG_ORCHESTRATION_DIR;
  process.env.PI_CONFIG_ORCHESTRATION_DIR = root;
  const pi = fakePi();
  const runtime = new OrchestrationRuntime(pi);
  const ctx = fakeContext(cwd);
  const spec = {
    version: 1,
    name: "background-smoke",
    outputStep: "scan",
    steps: [{ id: "scan", agent: "scout", task: "Inspect" }],
  };
  const definition = compileDeclarativeWorkflowSpec(spec, (agent) => agent === "worker");
  try {
    const receipt = await runtime.startBackgroundWorkflow({
      definition,
      spec,
      objective: "Smoke",
      paths: [],
      cwd,
      ctx,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
    });
    const completed = await waitForTerminal(receipt.runId);
    assert.equal(completed.status, "completed");
    assert.equal(completed.output, "fixture completed");
    assert.equal(completed.steps[0].thinking, "low");

    await runtime.scan(true);
    assert.equal(pi.messages.length, 1);
    assert.equal(pi.messages[0].message.details.runId, receipt.runId);
    assert.equal(pi.messages[0].options.triggerTurn, true);
    await runtime.scan(true);
    assert.equal(pi.messages.length, 1);
    assert.ok((await readRunById(receipt.runId)).deliveredAt);

    const review = createWorkflowRegistry().get("review");
    assert.ok(review);
    const staticReceipt = await runtime.startBackgroundWorkflow({
      definition: review,
      builtinName: "review",
      objective: "Static graph smoke",
      paths: [],
      cwd,
      ctx,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
    });
    const staticCompleted = await waitForTerminal(staticReceipt.runId);
    assert.equal(staticCompleted.status, "completed");
    assert.equal(staticCompleted.steps.length, 4);
    assert.ok(staticCompleted.steps.every((step) => step.status === "completed"));
    assert.deepEqual(Object.fromEntries(staticCompleted.steps.map((step) => [step.id, step.thinking])), {
      scout: "low",
      "correctness-review": "high",
      "security-review": "high",
      synthesis: "high",
    });
    await runtime.scan(true);
    assert.equal(pi.messages.length, 2);

    process.env.FAKE_PI_MODE = "quiet";
    const stoppable = await runtime.startBackgroundWorkflow({
      definition,
      spec,
      objective: "Stop smoke",
      paths: [],
      cwd,
      ctx,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
    });
    await waitForState(stoppable.runId, (state) => state.status === "running" && state.pid > 0);
    assert.match(await runtime.stopRun(stoppable.runId), /Stop requested/);
    assert.equal((await waitForTerminal(stoppable.runId)).status, "aborted");
    delete process.env.FAKE_PI_MODE;
  } finally {
    await pi.handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, ctx);
    delete process.env.FAKE_PI_MODE;
    if (previousRoot === undefined) delete process.env.PI_CONFIG_ORCHESTRATION_DIR;
    else process.env.PI_CONFIG_ORCHESTRATION_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});
