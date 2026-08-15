import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addUsage,
  agentDefinitionForTask,
  buildPiArgs,
  consumeProtocolLine,
  emptyUsage,
  mapConcurrent,
  resolvePiInvocation,
  resolveWorkspaceCwd,
  runChildAgent,
} from "../extensions/subagents-core.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));
const definition = {
  name: "scout",
  tools: ["read", "grep"],
  prompt: "Test role",
  thinking: "low",
  timeoutMs: 1_000,
  contextFiles: true,
};

function usage(input = 0) {
  return {
    input,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input,
    cost: { input: input / 100, output: 0, cacheRead: 0, cacheWrite: 0, total: input / 100 },
  };
}

test("child thinking follows the fixed task policy rather than parent session effort", () => {
  assert.equal(agentDefinitionForTask(definition, true).thinking, "low");
  assert.equal(agentDefinitionForTask(definition, true, "medium").thinking, "medium");
  assert.equal(agentDefinitionForTask(definition, false, "high").thinking, "off");
});

test("Pi child arguments are hermetic and role capabilities are fixed", () => {
  const args = buildPiArgs({
    definition: { ...definition, contextFiles: false, extensions: ["/safe/web.ts"] },
    promptPath: "/tmp/role.md",
    taskPath: "/tmp/task.md",
    model: "provider/model",
    thinking: "low",
  });

  for (const flag of [
    "--mode", "--print", "--no-session", "--no-approve", "--no-extensions",
    "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
  ]) assert.ok(args.includes(flag), flag);
  assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", "read,grep"]);
  assert.ok(args.includes("/safe/web.ts"));
  assert.ok(args.includes("@/tmp/task.md"));
  assert.equal(args.some((arg) => /share|external-cli|workflowScript/i.test(arg)), false);
});

test("Pi invocation never recursively treats an arbitrary test script as the Pi CLI", () => {
  const original = process.argv[1];
  try {
    process.argv[1] = "/tmp/live-orchestration.mjs";
    assert.deepEqual(resolvePiInvocation(["--mode", "json"]), { command: "pi", args: ["--mode", "json"] });
    process.argv[1] = "/opt/pi-coding-agent/dist/cli.js";
    assert.deepEqual(resolvePiInvocation(["--mode", "json"]), {
      command: process.execPath,
      args: ["/opt/pi-coding-agent/dist/cli.js", "--mode", "json"],
    });
  } finally {
    process.argv[1] = original;
  }
});

test("protocol parsing keeps final assistant text and aggregates usage", () => {
  const state = { output: "", usage: emptyUsage(), turns: 0 };
  assert.equal(consumeProtocolLine("not-json", state), false);
  assert.equal(consumeProtocolLine(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "first" }],
      provider: "test",
      model: "one",
      stopReason: "toolUse",
      usage: usage(10),
    },
  }), state), true);
  consumeProtocolLine(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "final" }],
      provider: "test",
      model: "one",
      stopReason: "stop",
      usage: usage(5),
    },
  }), state);
  assert.equal(state.output, "final");
  assert.equal(state.model, "test/one");
  assert.equal(state.turns, 2);
  assert.equal(state.usage.input, 15);
  assert.ok(Math.abs(state.usage.cost.total - 0.15) < Number.EPSILON);
  assert.equal(addUsage(usage(2), usage(3)).totalTokens, 5);
});

test("protocol progress never persists provider thinking deltas", () => {
  const state = { output: "", usage: emptyUsage(), turns: 0 };
  consumeProtocolLine(JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "private reasoning" },
  }), state);
  assert.equal(state.partialText, undefined);
  consumeProtocolLine(JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "visible text" },
  }), state);
  assert.equal(state.partialText, "visible text");
});

test("workspace cwd resolution rejects directory and symlink escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-subagent-cwd-"));
  const outside = await mkdtemp(join(tmpdir(), "pi-subagent-outside-"));
  try {
    await mkdir(join(root, "inside"));
    await symlink(outside, join(root, "escape"));
    assert.equal(await resolveWorkspaceCwd(root, "inside"), await realpath(join(root, "inside")));
    await assert.rejects(() => resolveWorkspaceCwd(root, ".."), /inside the current workspace/);
    await assert.rejects(() => resolveWorkspaceCwd(root, "escape"), /inside the current workspace/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("bounded concurrency preserves input order", async () => {
  let active = 0;
  let peak = 0;
  const results = await mapConcurrent([1, 2, 3, 4, 5], 2, async (value) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return value * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
  assert.equal(peak, 2);
});

test("child runner parses chunked Pi JSON and reports usage", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-run-"));
  try {
    const result = await runChildAgent({
      definition,
      task: { id: "fixture", agent: "scout", task: "Inspect the fixture", cwd },
      model: "fixture/test-model",
      thinking: "low",
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "success" },
    });
    assert.equal(result.status, "completed");
    assert.equal(result.output, "fixture completed");
    assert.equal(result.model, "fixture/test-model");
    assert.equal(result.usage.totalTokens, 17);
    assert.equal(result.usage.cost.total, 0.033);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("child runner reports tool activity and preserves final timing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-progress-"));
  const updates = [];
  try {
    const result = await runChildAgent({
      definition,
      task: { id: "tool", agent: "scout", task: "Use a tool", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "tool", FAKE_PI_DELAY_MS: "20" },
      onUpdate: (update) => updates.push(update.progress),
    });
    assert.equal(result.status, "completed");
    assert.ok(result.startedAt >= result.queuedAt);
    assert.ok(result.endedAt >= result.startedAt);
    assert.ok(result.firstProtocolAt >= result.spawnedAt);
    assert.ok(updates.some((update) => update.currentTool === "read" && update.currentToolStartedAt));
    assert.equal(updates.at(-1).lifecycle, "completed");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("read-only startup failures retry once but writers never retry", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-retry-"));
  const attemptFile = join(cwd, "attempt.txt");
  try {
    const recovered = await runChildAgent({
      definition,
      task: { id: "retry", agent: "scout", task: "Retry", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "transient", FAKE_PI_ATTEMPT_FILE: attemptFile },
      retryDelayMs: 1,
    });
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.attempts, 2);
    assert.equal(recovered.attemptErrors.length, 1);

    await rm(attemptFile, { force: true });
    const writerResult = await runChildAgent({
      definition: { ...definition, name: "worker", writer: true },
      task: { id: "writer", agent: "worker", task: "Do not retry", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "transient", FAKE_PI_ATTEMPT_FILE: attemptFile },
      retryDelayMs: 1,
    });
    assert.equal(writerResult.status, "failed");
    assert.equal(writerResult.attempts, 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("startup detection fails bounded read-only attempts instead of hanging", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-startup-"));
  try {
    const result = await runChildAgent({
      definition,
      task: { id: "startup", agent: "scout", task: "Never starts", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "startup-hang" },
      protocolAckTimeoutMs: 25,
      retryDelayMs: 1,
      timeoutMs: 500,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.failureKind, "startup");
    assert.equal(result.attempts, 2);
    assert.match(result.error, /no Pi protocol event/i);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("read-only tool budgets stop runaway loops without waiting for the role timeout", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-budget-"));
  try {
    const result = await runChildAgent({
      definition: { ...definition, maxToolCalls: 2 },
      task: { id: "budget", agent: "scout", task: "Loop", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "tool-loop" },
      timeoutMs: 1_000,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.failureKind, "budget");
    assert.ok(result.toolCalls > 2);
    assert.match(result.error, /tool-call read-only budget/);
    assert.ok(result.durationMs < 1_000);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("read-only reported-cost budgets fail a completed over-budget turn", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-cost-budget-"));
  try {
    const result = await runChildAgent({
      definition: { ...definition, maxCostUsd: 0.01 },
      task: { id: "cost", agent: "scout", task: "Cost", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "success" },
    });
    assert.equal(result.status, "failed");
    assert.equal(result.failureKind, "budget");
    assert.match(result.error, /cost budget/);
    assert.equal(result.output, "fixture completed");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("child runner handles malformed output, timeouts, and cancellation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-failure-"));
  try {
    const malformed = await runChildAgent({
      definition,
      task: { id: "bad", agent: "scout", task: "Malformed", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "malformed" },
    });
    assert.equal(malformed.status, "failed");
    assert.match(malformed.error, /malformed JSON/);

    const mixed = await runChildAgent({
      definition,
      task: { id: "mixed", agent: "scout", task: "Mixed protocol", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "mixed" },
    });
    assert.equal(mixed.status, "failed");
    assert.equal(mixed.output, "fixture completed");
    assert.match(mixed.error, /malformed JSON/);

    const timedOut = await runChildAgent({
      definition,
      task: { id: "slow", agent: "scout", task: "Wait", cwd },
      timeoutMs: 50,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "hang" },
    });
    assert.equal(timedOut.status, "timed_out");

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const aborted = await runChildAgent({
      definition,
      task: { id: "cancel", agent: "scout", task: "Wait", cwd },
      signal: controller.signal,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "hang" },
    });
    assert.equal(aborted.status, "aborted");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
