import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import subagentsExtension from "../extensions/subagents/index.ts";
import { applyTodoAction, emptyTodoSnapshot } from "../extensions/todo-core.ts";
import {
  createWorkerWorkspace,
  discardWorkerWorkspace,
  inspectWorkerPatch,
} from "../extensions/subagents/worktree.ts";

const exec = promisify(execFile);

function harness() {
  const tools = new Map();
  const events = new Map();
  const bus = new Map();
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand() {},
    on(name, handler) { events.set(name, handler); },
    events: {
      on(name, handler) { bus.set(name, handler); },
      emit(name, value) { bus.get(name)?.(value); },
    },
  };
  subagentsExtension(pi);
  return { pi, tools, events };
}

function context(cwd, branch = []) {
  const model = { provider: "test", id: "model", reasoning: false };
  return {
    cwd,
    mode: "json",
    model,
    modelRegistry: {
      getAvailable: () => [model],
      hasConfiguredAuth: () => true,
    },
    scopedModels: [],
    thinkingLevel: "off",
    isProjectTrusted: () => false,
    sessionManager: { getBranch: () => branch },
  };
}

const task = (id, todoId) => ({
  id,
  role: "explorer",
  title: `Explore ${id}`,
  objective: `Inspect ${id}`,
  ...(todoId === undefined ? {} : { todoId }),
  acceptanceCriteria: ["Return evidence"],
});

async function fakePi() {
  const root = await mkdtemp(join(tmpdir(), "pi-config-fake-pi-"));
  const script = join(root, "fake-pi.mjs");
  const invocationLog = join(root, "invocations.log");
  await writeFile(script, `
import { appendFileSync } from "node:fs";
appendFileSync(process.env.PI_TEST_INVOCATIONS, "run\\n");
const emit = value => process.stdout.write(JSON.stringify(value) + "\\n");
emit({type:"agent_start"});
const finish = () => {
  emit({type:"message_end",message:{role:"assistant",provider:"test",model:"model",stopReason:"stop",usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}});
  emit({type:"message_end",message:{role:"toolResult",toolName:"agent_result",details:{agentResult:{status:"succeeded",summary:"Done",evidence:["fixture"]}}}});
};
const delay = Number(process.env.PI_TEST_DELAY || 0);
if (delay) setTimeout(finish, delay); else finish();
`);
  if (process.platform === "win32") {
    await writeFile(join(root, "pi.cmd"), `@"${process.execPath}" "${script}" %*\r\n`);
  } else {
    const executable = join(root, "pi");
    await writeFile(executable, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    await chmod(executable, 0o700);
  }
  return { root, invocationLog };
}

async function invocationCount(path) {
  try {
    return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function waitForInvocation(path) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await invocationCount(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Fake child Pi did not launch");
}

async function withFakePi(run) {
  const fixture = await fakePi();
  const previous = {
    path: process.env.PATH,
    log: process.env.PI_TEST_INVOCATIONS,
    delay: process.env.PI_TEST_DELAY,
  };
  process.env.PATH = `${fixture.root}${process.platform === "win32" ? ";" : ":"}${previous.path ?? ""}`;
  process.env.PI_TEST_INVOCATIONS = fixture.invocationLog;
  delete process.env.PI_TEST_DELAY;
  try {
    return await run(fixture);
  } finally {
    if (previous.path === undefined) delete process.env.PATH;
    else process.env.PATH = previous.path;
    if (previous.log === undefined) delete process.env.PI_TEST_INVOCATIONS;
    else process.env.PI_TEST_INVOCATIONS = previous.log;
    if (previous.delay === undefined) delete process.env.PI_TEST_DELAY;
    else process.env.PI_TEST_DELAY = previous.delay;
    await rm(fixture.root, { recursive: true, force: true });
  }
}

test("parallel_agents executes a complete wave and reconciles todos", {
  skip: process.platform === "win32" && "Fixture uses a POSIX executable shim",
}, async () => withFakePi(async ({ invocationLog }) => {
  const h = harness();
  let snapshot = emptyTodoSnapshot();
  snapshot = applyTodoAction(snapshot, { action: "create", subject: "First" }).snapshot;
  snapshot = applyTodoAction(snapshot, { action: "create", subject: "Second" }).snapshot;
  h.pi.events.emit("pi-config:todo-snapshot", snapshot);

  const result = await h.tools.get("parallel_agents").execute("wave", {
    title: "Fixture wave",
    tasks: [task("one", 1), task("two", 2)],
    maxConcurrency: 1,
  }, undefined, undefined, context(process.cwd()));

  assert.equal(await invocationCount(invocationLog), 2);
  assert.deepEqual(result.details.results.map(({ status }) => status), ["succeeded", "succeeded"]);
  assert.deepEqual(
    result.details.todoSnapshot.tasks.map((todo) => [todo.status, todo.delegation?.phase]),
    [["in_progress", "awaiting_verification"], ["in_progress", "awaiting_verification"]],
  );
}));

test("parallel_agents does not launch queued tasks after cancellation", {
  skip: process.platform === "win32" && "Fixture uses a POSIX executable shim",
}, async () => withFakePi(async ({ invocationLog }) => {
  process.env.PI_TEST_DELAY = "5000";
  const h = harness();
  let snapshot = emptyTodoSnapshot();
  for (const subject of ["First", "Second", "Third"]) {
    snapshot = applyTodoAction(snapshot, { action: "create", subject }).snapshot;
  }
  h.pi.events.emit("pi-config:todo-snapshot", snapshot);
  const controller = new AbortController();
  const execution = h.tools.get("parallel_agents").execute("wave", {
    title: "Cancelled wave",
    tasks: [task("one", 1), task("two", 2), task("three", 3)],
    maxConcurrency: 1,
  }, controller.signal, undefined, context(process.cwd()));
  await waitForInvocation(invocationLog);
  controller.abort();
  const result = await execution;

  assert.equal(await invocationCount(invocationLog), 1);
  assert.deepEqual(result.details.results.map(({ status }) => status), ["cancelled", "cancelled", "cancelled"]);
  assert.deepEqual(
    result.details.todoSnapshot.tasks.map((todo) => [todo.status, todo.delegation]),
    [["pending", undefined], ["pending", undefined], ["pending", undefined]],
  );
}));

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "pi-config-agent-patch-tool-"));
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await exec("git", ["config", "user.name", "Test"], { cwd: root });
  await mkdir(join(root, "src"));
  await writeFile(join(root, ".gitignore"), ".pi/\n");
  await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
  await exec("git", ["add", "."], { cwd: root });
  await exec("git", ["commit", "-qm", "initial"], { cwd: root });
  return root;
}

test("agent_patch directly inspects and applies a recovered worker patch", async () => {
  const root = await repository();
  let workspace;
  try {
    workspace = await createWorkerWorkspace(root, "run", "worker", ["src/**"]);
    await writeFile(join(workspace.worktree, "src", "a.ts"), "export const a = '\u001b[31m';\n");
    const measured = await inspectWorkerPatch(workspace);
    const h = harness();
    const ctx = { ...context(root), isProjectTrusted: () => true };
    const inspected = await h.tools.get("agent_patch").execute("inspect", {
      action: "inspect",
      runId: "run",
      taskId: "worker",
    }, undefined, undefined, ctx);
    assert.equal(inspected.details.hash, measured.hash);
    assert.match(inspected.content[0].text, /\\x1b\[31m/);
    assert.doesNotMatch(inspected.content[0].text, /\u001b/);

    const applied = await h.tools.get("agent_patch").execute("apply", {
      action: "apply",
      runId: "run",
      taskId: "worker",
      expectedHash: inspected.details.hash,
    }, undefined, undefined, ctx);
    workspace = undefined;
    assert.equal(applied.details.patchState, "applied");
    assert.equal(await readFile(join(root, "src", "a.ts"), "utf8"), "export const a = '\u001b[31m';\n");
  } finally {
    if (workspace) await discardWorkerWorkspace(workspace).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("agent_patch reports applied state when post-apply cleanup fails", {
  skip: (process.platform === "win32" || process.getuid?.() === 0) && "Directory permissions do not provide a portable cleanup failure",
}, async () => {
  const root = await repository();
  let workspace;
  try {
    workspace = await createWorkerWorkspace(root, "cleanup", "worker", ["src/**"]);
    await writeFile(join(workspace.worktree, "src", "a.ts"), "export const a = 2;\n");
    const inspected = await inspectWorkerPatch(workspace);
    const metadataRoot = dirname(workspace.metadata);
    await chmod(metadataRoot, 0o500);

    const h = harness();
    const ctx = { ...context(root), isProjectTrusted: () => true };
    const applied = await h.tools.get("agent_patch").execute("apply", {
      action: "apply",
      runId: "cleanup",
      taskId: "worker",
      expectedHash: inspected.hash,
    }, undefined, undefined, ctx);

    assert.equal(applied.details.patchState, "applied");
    assert.match(applied.details.cleanupWarning, /permission|EACCES|EPERM|not permitted/i);
    assert.equal(await readFile(join(root, "src", "a.ts"), "utf8"), "export const a = 2;\n");
    await chmod(metadataRoot, 0o700);
  } finally {
    if (workspace) {
      await chmod(dirname(workspace.metadata), 0o700).catch(() => undefined);
      await discardWorkerWorkspace(workspace).catch(() => undefined);
    }
    await rm(root, { recursive: true, force: true });
  }
});
