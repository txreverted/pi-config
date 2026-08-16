import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentDefinitionForTask,
  buildPiArgs,
  consumeProtocolEvent,
  emptyUsage,
  mapConcurrent,
  resolvePiInvocation,
  resolveWorkspaceCwd,
  runChildAgent,
  truncateText,
} from "../extensions/subagents-core.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));
const definition = {
  name: "reviewer",
  tools: ["read", "grep"],
  prompt: "Test role",
  thinking: "low",
  timeoutMs: 1_000,
  contextFiles: true,
  mutatesWorkspace: false,
  maxTurns: 8,
  maxToolCalls: 8,
  maxReportedTokens: 100_000,
  maxCostUsd: 1,
};

function state() {
  return { output: "", usage: emptyUsage(), turns: 0, toolCalls: 0 };
}

test("child thinking follows the fixed role and model capability", () => {
  assert.equal(agentDefinitionForTask(definition, true).thinking, "low");
  assert.equal(agentDefinitionForTask(definition, false).thinking, "off");
});

test("Pi child arguments remove ambient resources and fix role capabilities", () => {
  const args = buildPiArgs({
    definition: { ...definition, contextFiles: false, extensions: ["/safe/web.ts"] },
    promptPath: "/tmp/role.md",
    taskPath: "/tmp/task.md",
    model: "provider/model",
  });
  for (const flag of [
    "--mode", "--print", "--no-session", "--no-approve", "--no-extensions",
    "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
  ]) assert.ok(args.includes(flag), flag);
  assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", "read,grep"]);
  assert.ok(args.includes("/safe/web.ts"));
  assert.ok(args.includes("@/tmp/task.md"));
});

test("Pi invocation does not treat an arbitrary script as the Pi CLI", () => {
  const original = process.argv[1];
  try {
    process.argv[1] = "/tmp/live-subagent.mjs";
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

test("protocol parsing keeps visible text, final output, and usage", () => {
  const protocol = state();
  assert.equal(consumeProtocolEvent("not-json", protocol), undefined);
  consumeProtocolEvent(JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "private reasoning" },
  }), protocol);
  assert.equal(protocol.partialText, undefined);
  consumeProtocolEvent(JSON.stringify({
    type: "message_update",
    usage: { input: 2, totalTokens: 2, cost: { total: 0.02 } },
    assistantMessageEvent: { type: "text_delta", delta: "visible" },
  }), protocol);
  assert.equal(protocol.partialText, "visible");
  assert.equal(protocol.streamingUsage.input, 2);
  consumeProtocolEvent(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "final" }],
      provider: "test",
      model: "one",
      stopReason: "stop",
      usage: { input: 5, totalTokens: 5, cost: { total: 0.1 } },
    },
  }), protocol);
  assert.equal(protocol.output, "final");
  assert.equal(protocol.model, "test/one");
  assert.equal(protocol.turns, 1);
  assert.equal(protocol.usage.input, 5);
  assert.equal(protocol.usage.cost.total, 0.1);
  assert.equal(protocol.streamingUsage, undefined);
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
  const results = await mapConcurrent([1, 2, 3, 4], 2, async (value) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return value * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8]);
  assert.equal(peak, 2);
});

test("child runner parses chunked Pi JSON and reports tool progress", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-run-"));
  const updates = [];
  try {
    const result = await runChildAgent({
      definition,
      task: { id: "fixture", agent: "reviewer", task: "Inspect the fixture", cwd },
      model: "fixture/test-model",
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "tool", FAKE_PI_DELAY_MS: "10" },
      onUpdate: (update) => updates.push(update),
    });
    assert.equal(result.status, "completed");
    assert.equal(result.output, "fixture completed");
    assert.equal(result.model, "fixture/test-model");
    assert.equal(result.usage.totalTokens, 17);
    assert.ok(updates.some((update) => update.currentTool === "read"));
    assert.ok(updates.some((update) => update.activity === "reading files"));
    assert.equal(updates.at(-1).status, "completed");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("child runner emits one-second progress heartbeats during silent tools", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-heartbeat-"));
  const controller = new AbortController();
  const updates = [];
  let running;
  t.mock.timers.enable({ apis: ["setInterval"] });
  try {
    running = runChildAgent({
      definition,
      task: { id: "heartbeat", agent: "reviewer", task: "Wait inside a tool", cwd },
      signal: controller.signal,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "tool-hang" },
      onUpdate: (update) => updates.push(update),
    });

    const deadline = Date.now() + 1_000;
    while (!updates.some((update) => update.currentTool === "read")) {
      if (Date.now() >= deadline) throw new Error("Timed out waiting for child tool progress");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const beforeHeartbeat = updates.length;
    t.mock.timers.tick(1_000);
    assert.equal(updates.length, beforeHeartbeat + 1);
    assert.equal(updates.at(-1).currentTool, "read");

    controller.abort();
    assert.equal((await running).status, "aborted");
    const afterAbort = updates.length;
    t.mock.timers.tick(1_000);
    assert.equal(updates.length, afterAbort);
  } finally {
    controller.abort();
    await running?.catch(() => {});
    await rm(cwd, { recursive: true, force: true });
  }
});

test("child progress summarizes edited file count", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-activity-"));
  const updates = [];
  try {
    const result = await runChildAgent({
      definition,
      task: { id: "activity", agent: "reviewer", task: "Edit fixtures", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "edit-files", FAKE_PI_DELAY_MS: "10" },
      onUpdate: (update) => updates.push(update),
    });
    assert.equal(result.status, "completed");
    assert.ok(updates.some((update) => update.activity === "editing 1 file"));
    assert.ok(updates.some((update) => update.activity === "editing 2 files"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("child output remains capped in results and progress", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-output-"));
  const updates = [];
  try {
    const result = await runChildAgent({
      definition,
      task: { id: "large", agent: "reviewer", task: "Return lots", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "large" },
      onUpdate: (update) => updates.push(update),
    });
    assert.equal(result.status, "completed");
    assert.ok(Buffer.byteLength(result.output, "utf8") <= 16_000);
    assert.ok(Buffer.byteLength(result.text, "utf8") <= 16_000);
    assert.ok(updates.every((update) => Buffer.byteLength(update.text, "utf8") <= 16_000));

    const unicode = truncateText("😀".repeat(20_000));
    assert.equal(unicode.truncated, true);
    assert.ok(Buffer.byteLength(unicode.text, "utf8") <= 16_000);
    assert.doesNotMatch(unicode.text, /�/);

    const lines = truncateText(Array.from({ length: 2_100 }, () => "x").join("\n"));
    assert.equal(lines.truncated, true);
    assert.ok(lines.text.split("\n").length <= 2_002);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("child runner accepts Pi-sized JSON events and rejects larger lines", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-json-size-"));
  try {
    const accepted = await runChildAgent({
      definition,
      task: { id: "large-event", agent: "reviewer", task: "Read a large image", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: {
        FAKE_PI_MODE: "large-json-event",
        FAKE_PI_JSON_EVENT_CHARS: String(4.5 * 1024 * 1024),
      },
      timeoutMs: 5_000,
    });
    assert.equal(accepted.status, "completed");
    assert.equal(accepted.output, "fixture completed");

    const rejected = await runChildAgent({
      definition,
      task: { id: "oversized-event", agent: "reviewer", task: "Reject an oversized event", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: {
        FAKE_PI_MODE: "large-json-event",
        FAKE_PI_JSON_EVENT_CHARS: String(8 * 1024 * 1024),
      },
      timeoutMs: 5_000,
    });
    assert.equal(rejected.status, "failed");
    assert.match(rejected.error, /Child JSON event exceeded 8388608 characters/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("startup and tool budgets stop bounded children", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-bounds-"));
  try {
    const startup = await runChildAgent({
      definition,
      task: { id: "startup", agent: "reviewer", task: "Never starts", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "startup-hang" },
      startupTimeoutMs: 25,
      timeoutMs: 500,
    });
    assert.equal(startup.status, "failed");
    assert.match(startup.error, /no Pi protocol event/i);

    const budget = await runChildAgent({
      definition: { ...definition, maxToolCalls: 2 },
      task: { id: "budget", agent: "reviewer", task: "Loop", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "tool-loop" },
    });
    assert.equal(budget.status, "failed");
    assert.match(budget.error, /tool-call budget/);

    const cost = await runChildAgent({
      definition: { ...definition, maxCostUsd: 0.01 },
      task: { id: "cost", agent: "reviewer", task: "Cost", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "success" },
    });
    assert.equal(cost.status, "failed");
    assert.equal(cost.output, "fixture completed");
    assert.match(cost.error, /cost budget/);

    const streamingCost = await runChildAgent({
      definition: { ...definition, maxCostUsd: 1 },
      task: { id: "stream-cost", agent: "reviewer", task: "Stream cost", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "stream-budget" },
    });
    assert.equal(streamingCost.status, "failed");
    assert.equal(streamingCost.output, "streaming");
    assert.equal(streamingCost.usage.cost.total, 2);
    assert.match(streamingCost.error, /cost budget/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("child runner handles malformed output, timeout, and cancellation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-failure-"));
  try {
    const malformed = await runChildAgent({
      definition,
      task: { id: "bad", agent: "reviewer", task: "Malformed", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "malformed" },
    });
    assert.equal(malformed.status, "failed");
    assert.match(malformed.error, /malformed JSON/);

    const malformedHang = await runChildAgent({
      definition,
      task: { id: "bad-hang", agent: "reviewer", task: "Malformed then hang", cwd },
      timeoutMs: 500,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "malformed-hang" },
    });
    assert.equal(malformedHang.status, "failed");
    assert.match(malformedHang.error, /malformed JSON/);

    const stderrFailure = await runChildAgent({
      definition,
      task: { id: "stderr", agent: "reviewer", task: "Fail on stderr", cwd },
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "stderr-failure" },
    });
    assert.equal(stderrFailure.status, "failed");
    assert.equal(stderrFailure.stderr, "provider authentication failed");

    const timedOut = await runChildAgent({
      definition,
      task: { id: "slow", agent: "reviewer", task: "Wait", cwd },
      timeoutMs: 40,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "quiet" },
    });
    assert.equal(timedOut.status, "timed_out");

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const aborted = await runChildAgent({
      definition,
      task: { id: "cancel", agent: "reviewer", task: "Wait", cwd },
      signal: controller.signal,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "hang" },
    });
    assert.equal(aborted.status, "aborted");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("cancellation kills descendants that ignore graceful termination", { skip: process.platform === "win32" }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-descendant-"));
  const pidFile = join(cwd, "descendant.pid");
  const controller = new AbortController();
  let descendantPid;
  let running;
  try {
    running = runChildAgent({
      definition,
      task: { id: "descendant", agent: "reviewer", task: "Spawn descendant", cwd },
      signal: controller.signal,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "stubborn-descendant", FAKE_PI_PID_FILE: pidFile },
    });

    const pidDeadline = Date.now() + 1_000;
    while (descendantPid === undefined && Date.now() < pidDeadline) {
      try {
        descendantPid = Number(await readFile(pidFile, "utf8"));
      } catch {
        await sleep(10);
      }
    }
    assert.ok(descendantPid);
    controller.abort();
    assert.equal((await running).status, "aborted");

    const exitDeadline = Date.now() + 1_000;
    let alive = true;
    while (alive && Date.now() < exitDeadline) {
      try {
        process.kill(descendantPid, 0);
        await sleep(10);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
        alive = false;
      }
    }
    assert.equal(alive, false, `descendant ${descendantPid} survived cancellation`);
  } finally {
    controller.abort();
    await running?.catch(() => {});
    if (descendantPid) {
      try { process.kill(descendantPid, "SIGKILL"); } catch {}
    }
    await rm(cwd, { recursive: true, force: true });
  }
});
