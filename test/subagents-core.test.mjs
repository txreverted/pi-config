import test from "node:test";
import assert from "node:assert/strict";
import fsPromises, { access, mkdtemp, mkdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  SUBAGENT_STALE_TIMEOUT_MS,
  truncateText,
} from "../extensions/subagents-core.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));
const definition = {
  name: "reviewer",
  tools: ["read", "grep"],
  prompt: "Test role",
  thinking: "low",
  contextFiles: true,
  mutatesWorkspace: false,
};

function childTask(id, task, cwd) {
  return { id, name: "Fixture task", agent: "reviewer", task, cwd };
}

function state() {
  return { output: "", usage: emptyUsage(), turns: 0, toolCalls: 0 };
}

test("child thinking follows the fixed role and model capability", () => {
  assert.equal(SUBAGENT_STALE_TIMEOUT_MS, 150_000);
  assert.equal(agentDefinitionForTask(definition, true).thinking, "low");
  assert.equal(agentDefinitionForTask(definition, false).thinking, "off");
});

test("Pi child arguments remove ambient resources and fix role capabilities", () => {
  const args = buildPiArgs({
    definition: { ...definition, contextFiles: false, extensions: ["/safe/web.ts"] },
    promptPath: "/tmp/role.md",
  });
  for (const flag of [
    "--no-approve", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
  ]) assert.ok(args.includes(flag), flag);
  for (const removed of ["--print", "--no-session"]) assert.equal(args.includes(removed), false, removed);
  assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", "read,grep"]);
  assert.ok(args.includes("/safe/web.ts"));
  assert.equal(args.includes("@/tmp/task.md"), false);
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

test("child runner parses chunked Pi JSON, reports progress, and removes private run files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-run-"));
  const taskPathFile = join(cwd, "task-path");
  const updates = [];
  try {
    const result = await runChildAgent({
      definition,
      task: childTask("fixture", "Inspect the fixture", cwd),
      model: "fixture/test-model",
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "tool", FAKE_PI_DELAY_MS: "10", FAKE_PI_TASK_PATH_FILE: taskPathFile },
      onUpdate: (update) => updates.push(update),
    });
    assert.equal(result.status, "done");
    assert.equal(result.output, "fixture completed");
    assert.equal(result.model, "fixture/test-model");
    assert.equal(result.usage.totalTokens, 17);
    assert.ok(updates.some((update) => update.currentTool === "read"));
    assert.ok(updates.some((update) => update.activity === "reading files"));
    assert.equal(updates.at(-1).status, "done");
    const taskPath = await readFile(taskPathFile, "utf8");
    await assert.rejects(() => access(dirname(taskPath)));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a successful child retry clears an earlier assistant error", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-retry-"));
  try {
    const result = await runChildAgent({
      definition,
      task: childTask("retry", "Recover from a provider error", cwd),
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "error-then-success" },
    });
    assert.equal(result.status, "done");
    assert.equal(result.output, "fixture completed");
    assert.equal(result.turns, 2);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("an empty final child response does not reuse earlier commentary", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-empty-final-"));
  try {
    const updates = [];
    const result = await runChildAgent({
      definition,
      task: childTask("empty-final", "Return an empty final response", cwd),
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "empty-final" },
      onUpdate: (update) => updates.push(update),
    });
    assert.equal(result.status, "bugged");
    assert.equal(result.output, "");
    assert.match(result.error, /no final text response/);
    const finalUpdates = updates.filter((update) => update.turns === 2);
    assert.ok(finalUpdates.length > 0);
    assert.ok(finalUpdates.every((update) => update.text === ""));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("child runner reports and preserves a run directory when cleanup fails", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-cleanup-failure-"));
  const taskPathFile = join(cwd, "task-path");
  const originalRm = fsPromises.rm;
  let runDirectory;
  fsPromises.rm = async (path, options) => {
    if (String(path).includes("pi-config-subagent-")) throw new Error("forced cleanup failure");
    return originalRm(path, options);
  };
  syncBuiltinESMExports();
  try {
    const result = await runChildAgent({
      definition,
      task: childTask("cleanup", "Exercise cleanup failure", cwd),
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_TASK_PATH_FILE: taskPathFile },
    });
    runDirectory = dirname(await readFile(taskPathFile, "utf8"));
    assert.equal(result.status, "error");
    assert.match(result.error, /Failed to remove subagent run files at .*pi-config-subagent-.*: forced cleanup failure/);
    assert.match(result.error, new RegExp(runDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await access(runDirectory);
  } finally {
    fsPromises.rm = originalRm;
    syncBuiltinESMExports();
    if (runDirectory) await rm(runDirectory, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test("failed setup cleanup reports the leaked run directory", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-setup-cleanup-"));
  const originalWriteFile = fsPromises.writeFile;
  const originalRm = fsPromises.rm;
  let leakedDirectory;
  fsPromises.writeFile = async (path, options) => {
    if (String(path).includes("pi-config-subagent-")) throw new Error("forced write failure");
    return originalWriteFile(path, options);
  };
  fsPromises.rm = async (path, options) => {
    if (String(path).includes("pi-config-subagent-")) throw new Error("forced cleanup failure");
    return originalRm(path, options);
  };
  syncBuiltinESMExports();
  try {
    const result = await runChildAgent({
      definition,
      task: childTask("setup-cleanup", "Fail setup cleanup", cwd),
      invocation: { command: process.execPath, argsPrefix: [fixture] },
    });
    assert.equal(result.status, "error");
    assert.match(result.error, /Failed to create and clean up subagent run files at .*pi-config-subagent-/);
    leakedDirectory = result.error.split(" at ").at(-1);
    await access(leakedDirectory);
  } finally {
    fsPromises.writeFile = originalWriteFile;
    fsPromises.rm = originalRm;
    syncBuiltinESMExports();
    if (leakedDirectory) await rm(leakedDirectory, { recursive: true, force: true });
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
      task: childTask("heartbeat", "Wait inside a tool", cwd),
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
    assert.equal((await running).status, "error");
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
      task: childTask("activity", "Edit fixtures", cwd),
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "edit-files", FAKE_PI_DELAY_MS: "10" },
      onUpdate: (update) => updates.push(update),
    });
    assert.equal(result.status, "done");
    assert.ok(updates.some((update) => update.activity === "editing 1 file"));
    assert.ok(updates.some((update) => update.activity === "editing 2 files"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("child progress reports distinct tool activities", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-activities-"));
  const updates = [];
  try {
    const result = await runChildAgent({
      definition,
      task: childTask("activities", "Report activities", cwd),
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "activities" },
      onUpdate: (update) => updates.push(update),
    });
    assert.equal(result.status, "done");
    const activities = new Set(updates.map((update) => update.activity));
    for (const activity of [
      "searching",
      "reading source",
      "running checks",
      "inspecting changes",
      "analyzing data",
      "browsing files",
      "running command",
      "reading files",
    ]) assert.ok(activities.has(activity), activity);
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
      task: childTask("large", "Return lots", cwd),
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "large" },
      onUpdate: (update) => updates.push(update),
    });
    assert.equal(result.status, "done");
    assert.ok(Buffer.byteLength(result.output, "utf8") <= 16_000);
    assert.ok(Buffer.byteLength(result.text, "utf8") <= 16_000);
    assert.ok(updates.every((update) => Buffer.byteLength(update.text, "utf8") <= 16_000));

    const unicode = truncateText("😀".repeat(20_000));
    assert.equal(unicode.truncated, true);
    assert.ok(Buffer.byteLength(unicode.text, "utf8") <= 16_000);
    assert.doesNotMatch(unicode.text, /�/);

    const lines = truncateText(Array.from({ length: 2_100 }, () => "x").join("\n"));
    assert.equal(lines.truncated, true);
    assert.ok(lines.text.split("\n").length <= 2_000);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("RpcClient accepts large native events while bounded child output stays capped", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-json-size-"));
  try {
    const accepted = await runChildAgent({
      definition,
      task: childTask("large-event", "Read a large image", cwd),
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: {
        FAKE_PI_MODE: "large-json-event",
        FAKE_PI_JSON_EVENT_CHARS: String(4.5 * 1024 * 1024),
      },
      staleTimeoutMs: 5_000,
    });
    assert.equal(accepted.status, "done");
    assert.equal(accepted.output, "fixture completed");

    const rejected = await runChildAgent({
      definition,
      task: childTask("oversized-event", "Reject an oversized event", cwd),
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: {
        FAKE_PI_MODE: "large-json-event",
        FAKE_PI_JSON_EVENT_CHARS: String(8 * 1024 * 1024),
      },
      staleTimeoutMs: 5_000,
    });
    assert.equal(rejected.status, "done");
    assert.ok(Buffer.byteLength(rejected.output) <= 16_000);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("startup faults are bugged while tool and cost usage never stop children", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-stops-"));
  try {
    const startup = await runChildAgent({
      definition,
      task: childTask("startup", "Never starts", cwd),
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "startup-hang" },
      startupTimeoutMs: 25,
      staleTimeoutMs: 500,
    });
    assert.equal(startup.status, "bugged");
    assert.match(startup.error, /no Pi protocol event/i);

    const manyTools = await runChildAgent({
      definition,
      task: childTask("many-tools", "Use many tools", cwd),
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "tool-loop" },
    });
    assert.equal(manyTools.status, "done");
    assert.equal(manyTools.toolCalls, 10);

    const highCost = await runChildAgent({
      definition,
      task: childTask("high-cost", "Spend reported cost", cwd),
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "high-stream-cost", FAKE_PI_DELAY_MS: "10" },
    });
    assert.equal(highCost.status, "done");
    assert.equal(highCost.output, "fixture completed");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("terminal length stop reasons remain errors even with partial text", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-length-"));
  try {
    const result = await runChildAgent({
      definition,
      task: childTask("length", "Stop at a length limit", cwd),
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "length" },
    });
    assert.equal(result.status, "error");
    assert.equal(result.output, "fixture completed");
    assert.match(result.error, /length/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("observable protocol and stderr activity reset staleness", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-stale-reset-"));
  try {
    const result = await runChildAgent({
      definition,
      task: childTask("active", "Stay active", cwd),
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "activity-heartbeats", FAKE_PI_DELAY_MS: "200" },
      staleTimeoutMs: 500,
    });
    assert.equal(result.status, "done");
    assert.match(result.stderr, /still working/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("interrupted child output prefers the current partial response", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-partial-"));
  const controller = new AbortController();
  const safetyTimer = setTimeout(() => controller.abort(), 1_000);
  try {
    const result = await runChildAgent({
      definition,
      task: childTask("partial", "Interrupt a later response", cwd),
      signal: controller.signal,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "interrupted-partial" },
      onUpdate: (progress) => {
        if (progress.text === "new partial response") controller.abort();
      },
    });
    assert.equal(result.status, "error");
    assert.equal(result.output, "new partial response");
  } finally {
    clearTimeout(safetyTimer);
    controller.abort();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("interrupted large partial output reports truncation without losing its prefix", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-large-partial-"));
  const controller = new AbortController();
  const safetyTimer = setTimeout(() => controller.abort(), 1_000);
  try {
    const result = await runChildAgent({
      definition,
      task: childTask("large-partial", "Interrupt a large response", cwd),
      signal: controller.signal,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "interrupted-large-partial" },
      onUpdate: (progress) => {
        if (progress.text.includes("Subagent output truncated")) controller.abort();
      },
    });
    assert.equal(result.status, "error");
    assert.equal(result.truncated, true);
    assert.match(result.output, /^BEGINx+/);
    assert.doesNotMatch(result.output, /END/);
    assert.match(result.output, /Subagent output truncated/);
  } finally {
    clearTimeout(safetyTimer);
    controller.abort();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("child stderr is bounded and never forwarded raw to the parent terminal", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-stderr-bound-"));
  const originalWrite = process.stderr.write;
  let forwarded = "";
  process.stderr.write = (chunk) => { forwarded += String(chunk); return true; };
  try {
    const result = await runChildAgent({
      definition,
      task: childTask("stderr-large", "Emit unsafe stderr", cwd),
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "stderr-large" },
    });
    assert.equal(result.status, "error");
    assert.ok(Buffer.byteLength(result.stderr, "utf8") <= 64 * 1024);
    assert.equal(forwarded, "");
    assert.doesNotMatch(result.stderr, /payload/);
  } finally {
    process.stderr.write = originalWrite;
    await rm(cwd, { recursive: true, force: true });
  }
});

test("child runner classifies malformed output, staleness, errors, and cancellation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-failure-"));
  try {
    const malformed = await runChildAgent({
      definition,
      task: childTask("bad", "Malformed", cwd),
      staleTimeoutMs: 100,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "malformed" },
    });
    assert.equal(malformed.status, "error");

    const malformedHang = await runChildAgent({
      definition,
      task: childTask("bad-hang", "Malformed then hang", cwd),
      staleTimeoutMs: 500,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "malformed-hang" },
    });
    assert.equal(malformedHang.status, "stale");

    const stderrFailure = await runChildAgent({
      definition,
      task: childTask("stderr", "Fail on stderr", cwd),
      staleTimeoutMs: 100,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "stderr-failure" },
    });
    assert.equal(stderrFailure.status, "error");
    assert.equal(stderrFailure.stderr, "provider authentication failed");

    const stale = await runChildAgent({
      definition,
      task: childTask("slow", "Wait", cwd),
      staleTimeoutMs: 40,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "quiet" },
    });
    assert.equal(stale.status, "stale");

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const aborted = await runChildAgent({
      definition,
      task: childTask("cancel", "Wait", cwd),
      signal: controller.signal,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "hang" },
    });
    assert.equal(aborted.status, "error");
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
      task: childTask("descendant", "Spawn descendant", cwd),
      signal: controller.signal,
      invocation: { command: process.execPath, argsPrefix: [fixture] },
      env: { FAKE_PI_MODE: "stubborn-descendant", FAKE_PI_PID_FILE: pidFile },
    });

    const pidDeadline = Date.now() + 1_000;
    while (descendantPid === undefined && Date.now() < pidDeadline) {
      try {
        const parsed = Number((await readFile(pidFile, "utf8")).trim());
        if (Number.isSafeInteger(parsed) && parsed > 0) descendantPid = parsed;
        else await sleep(10);
      } catch {
        await sleep(10);
      }
    }
    assert.ok(descendantPid);
    controller.abort();
    assert.equal((await running).status, "error");

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
