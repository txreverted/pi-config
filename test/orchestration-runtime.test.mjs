import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandMatchesWorkflowHost, OrchestrationRuntime } from "../extensions/orchestration-runtime.ts";
import { readRunById } from "../extensions/orchestration-state.ts";

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

test("orchestration keeps the area below the input empty", () => {
  const pi = fakePi();
  const runtime = new OrchestrationRuntime(pi);
  const ctx = fakeContext(process.cwd());
  const widgetCalls = [];
  ctx.mode = "tui";
  ctx.hasUI = true;
  ctx.ui.setWidget = (...args) => widgetCalls.push(args);

  runtime.bind(ctx);
  assert.deepEqual(widgetCalls, [["orchestration-runs", undefined]]);
  pi.handlers.get("session_shutdown")();
});

test("workflow host ownership matching is strict and Windows-case-insensitive", () => {
  const host = "C:\\Pi\\workflow-host.ts";
  const config = "C:\\Runs\\review\\config.json";
  assert.equal(commandMatchesWorkflowHost(`node ${host} ${config}`, host, config, true), true);
  assert.equal(commandMatchesWorkflowHost(`node c:\\pi\\WORKFLOW-HOST.ts c:\\runs\\review\\CONFIG.json`, host, config, true), true);
  assert.equal(commandMatchesWorkflowHost(`node ${host} C:\\Runs\\other\\config.json`, host, config, true), false);
  assert.equal(commandMatchesWorkflowHost(`node ${host}.bak ${config}.bak`, host, config, true), false);
  assert.equal(commandMatchesWorkflowHost(`node "${host}" "${config}"`, host, config, true), true);
});

test("background runtime rejects caller-supplied workflow graphs", async () => {
  const pi = fakePi();
  const runtime = new OrchestrationRuntime(pi);
  const ctx = fakeContext(process.cwd());
  await assert.rejects(
    () => runtime.startBackgroundWorkflow({
      builtinName: "review",
      definition: { name: "review", steps: [] },
      objective: "spoof",
      paths: [],
      cwd: process.cwd(),
      ctx,
    }),
    /Caller-supplied workflow definitions/,
  );
});

test("background runtime survives tool return, delivers once, and can stop a live host", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-orchestration-runtime-"));
  const cwd = await mkdtemp(join(tmpdir(), "pi-orchestration-runtime-cwd-"));
  const previousRoot = process.env.PI_CONFIG_ORCHESTRATION_DIR;
  process.env.PI_CONFIG_ORCHESTRATION_DIR = root;
  const pi = fakePi();
  const runtime = new OrchestrationRuntime(pi);
  const ctx = fakeContext(cwd);
  try {
    const receipt = await runtime.startBackgroundWorkflow({
      builtinName: "review",
      objective: "Static graph smoke",
      paths: [],
      cwd,
      ctx,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
    });
    const completed = await waitForTerminal(receipt.runId);
    assert.equal(completed.status, "completed");
    assert.equal(completed.output, "fixture completed");
    assert.equal(completed.steps.length, 4);
    assert.ok(completed.steps.every((step) => step.status === "completed"));

    await runtime.scan(true);
    assert.equal(pi.messages.length, 1);
    assert.equal(pi.messages[0].message.details.runId, receipt.runId);
    assert.equal(pi.messages[0].options.triggerTurn, true);
    await runtime.scan(true);
    assert.equal(pi.messages.length, 1);
    assert.ok((await readRunById(receipt.runId)).deliveredAt);

    process.env.FAKE_PI_MODE = "quiet";
    const stoppable = await runtime.startBackgroundWorkflow({
      builtinName: "review",
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
