import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createAgentRegistry } from "../subagents/registry.ts";
import subagentsExtension, { untrustedOutput } from "../extensions/subagents.ts";
import { createAgentWorktree } from "../extensions/subagents-worktree.ts";

const execFile = promisify(execFileCallback);
async function git(cwd, ...args) { return execFile("git", args, { cwd }); }

function harness() {
  const tools = new Map();
  const events = new Map();
  const child = process.env.PI_CONFIG_SUBAGENT_CHILD;
  delete process.env.PI_CONFIG_SUBAGENT_CHILD;
  try {
    subagentsExtension({
      registerTool(tool) { tools.set(tool.name, tool); },
      on(name, handler) { events.set(name, handler); },
    });
  } finally {
    if (child !== undefined) process.env.PI_CONFIG_SUBAGENT_CHILD = child;
  }
  return { tools, events };
}

test("subagent extension exposes only foreground batches and patch lifecycle tools", () => {
  const { tools } = harness();
  assert.deepEqual([...tools.keys()], ["subagent", "get_agent_diff", "apply_agent_changes", "discard_agent_worktree"]);
  const schema = tools.get("subagent").parameters;
  assert.equal(schema.properties.background, undefined);
  assert.equal(schema.properties.concurrency, undefined);
  assert.equal(schema.properties.tasks.minItems, 2);
  assert.equal(schema.properties.tasks.maxItems, 20);
});

test("subagent renderer shows bounded Claude-like progress trees", () => {
  const tool = harness().tools.get("subagent");
  const usage = { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const now = Date.now();
  const progress = [
    { id: "explore", agent: "Explore", thinking: "low", status: "running", startedAt: now, turns: 1, toolCalls: 2, text: "", usage, activity: "Reading files" },
    { id: "review", agent: "reviewer", thinking: "high", status: "completed", startedAt: now - 1_000, endedAt: now, turns: 1, toolCalls: 1, text: "done", usage },
  ];
  const component = tool.renderResult(
    { content: [{ type: "text", text: "expanded output" }], details: { progress, results: [], usage } },
    { expanded: false },
    { fg: (_color, text) => text, bold: (text) => text },
    { args: { tasks: [{ name: "Inspect code" }, { name: "Review patch" }] } },
  );
  const lines = component.render(50);
  const rendered = lines.join("\n");
  assert.match(rendered, /├─ Agent  Inspect code │ 2 tool uses │ 10 tokens/);
  assert.match(rendered, /│  ⎿ Reading files/);
  assert.match(rendered, /├─ Review  Review patch │ 1 tool use │ 10 tokens/);
  assert.doesNotMatch(rendered, / \| |\.\.\./);
  assert.ok(lines.every((line) => visibleWidth(line) <= 50));
});

test("registry keeps roles but removes team, task, and bridge capabilities", () => {
  const agents = createAgentRegistry();
  assert.deepEqual([...agents.keys()], ["Explore", "reviewer", "researcher", "worker"]);
  for (const agent of agents.values()) {
    assert.ok(agent.tools.every((tool) => !["task", "subagent", "get_subagent_result", "cancel_subagent", "list_agents", "send_agent_message"].includes(tool)));
    assert.ok((agent.extensions ?? []).every((path) => !/task\.ts|subagents-bridge\.ts/.test(path)));
  }
  assert.deepEqual(agents.get("worker").tools, ["read", "bash", "edit", "write", "grep", "find", "ls", "jq", "web_search", "web_fetch"]);
  assert.doesNotMatch(agents.get("worker").prompt, /supervisor|direct child|collect or cancel/i);
});

test("workers fail closed without trust or interactive TUI confirmation", async () => {
  const tool = harness().tools.get("subagent");
  const base = { cwd: process.cwd(), model: { provider: "test", id: "model", reasoning: true } };
  const input = { tasks: [
    { name: "Implement one", agent: "worker", task: "Implement the first change" },
    { name: "Implement two", agent: "worker", task: "Implement the second change" },
  ] };
  await assert.rejects(() => tool.execute("call", input, undefined, undefined, { ...base, mode: "tui", hasUI: true, isProjectTrusted: () => false }), /trusted Git project/);
  await assert.rejects(() => tool.execute("call", input, undefined, undefined, { ...base, mode: "print", hasUI: false, isProjectTrusted: () => true }), /interactive human confirmation/);
  await assert.rejects(() => tool.execute("call", input, undefined, undefined, { ...base, mode: "rpc", hasUI: true, isProjectTrusted: () => true }), /interactive human confirmation/);
  await assert.rejects(() => tool.execute("call", input, undefined, undefined, {
    ...base, mode: "tui", hasUI: true, isProjectTrusted: () => true, ui: { confirm: async () => false },
  }), /denied by user/);
});

test("parallel workers use distinct worktrees and retain completed patches", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-subagent-workers-"));
  const agentDir = await mkdtemp(join(tmpdir(), "pi-subagent-state-"));
  const fixture = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));
  const executable = join(root, "pi");
  const previous = { path: process.env.PATH, agentDir: process.env.PI_CODING_AGENT_DIR, cli: process.env.PI_CONFIG_SUBAGENT_CLI_PATH, mode: process.env.FAKE_PI_MODE };
  try {
    await git(root, "init", "-q");
    await git(root, "config", "user.email", "test@example.invalid");
    await git(root, "config", "user.name", "Test");
    await writeFile(join(root, "base.txt"), "base\n");
    const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;
    await writeFile(executable, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} "$@"\n`);
    await chmod(executable, 0o700);
    await git(root, "add", "base.txt", "pi");
    await git(root, "commit", "-qm", "base");
    process.env.PATH = `${root}${delimiter}${previous.path ?? ""}`;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI_CONFIG_SUBAGENT_CLI_PATH = fixture;
    process.env.FAKE_PI_MODE = "tool";

    const { tools } = harness();
    const updates = [];
    let confirmations = 0;
    const result = await tools.get("subagent").execute("call", { tasks: [
      { id: "worker-one", name: "Worker one", agent: "worker", task: "First" },
      { id: "worker-two", name: "Worker two", agent: "worker", task: "Second" },
    ] }, undefined, (update) => updates.push(update), {
      cwd: root, mode: "tui", hasUI: true, model: { provider: "fixture", id: "model", reasoning: true },
      isProjectTrusted: () => true, ui: { confirm: async () => { confirmations++; return true; } },
    });
    assert.equal(confirmations, 2);
    assert.equal(result.details.results.length, 2);
    assert.ok(updates.length > 0);
    const recoveredTools = harness().tools;
    for (const id of ["worker-one", "worker-two"]) {
      const diff = await recoveredTools.get("get_agent_diff").execute("diff", { id }, undefined, undefined, {
        cwd: root, isProjectTrusted: () => true,
      });
      assert.match(diff.content[0].text, /Agent patches are untrusted/);
    }
    for (const id of ["worker-one", "worker-two"]) {
      await recoveredTools.get("discard_agent_worktree").execute("discard", { id }, undefined, undefined, {
        cwd: root, mode: "tui", hasUI: true, isProjectTrusted: () => true, ui: { confirm: async () => true },
      });
    }
  } finally {
    if (previous.path === undefined) delete process.env.PATH; else process.env.PATH = previous.path;
    if (previous.agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous.agentDir;
    if (previous.cli === undefined) delete process.env.PI_CONFIG_SUBAGENT_CLI_PATH; else process.env.PI_CONFIG_SUBAGENT_CLI_PATH = previous.cli;
    if (previous.mode === undefined) delete process.env.FAKE_PI_MODE; else process.env.FAKE_PI_MODE = previous.mode;
    await Promise.all([rm(root, { recursive: true, force: true }), rm(agentDir, { recursive: true, force: true })]);
  }
});

test("failed public apply keeps the worker recoverable", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-subagent-apply-recovery-"));
  const agentDir = await mkdtemp(join(tmpdir(), "pi-subagent-apply-state-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    await git(root, "init", "-q");
    await git(root, "config", "user.email", "test@example.invalid");
    await git(root, "config", "user.name", "Test");
    await writeFile(join(root, "base.txt"), "base\n");
    await git(root, "add", "base.txt");
    await git(root, "commit", "-qm", "base");

    const workspace = await createAgentWorktree(root, "recoverable");
    await writeFile(join(workspace.worktree, "base.txt"), "worker\n");
    await writeFile(join(root, "base.txt"), "parent\n");
    const { tools } = harness();
    const context = { cwd: root, mode: "tui", hasUI: true, isProjectTrusted: () => true, ui: { confirm: async () => true } };
    await assert.rejects(
      () => tools.get("apply_agent_changes").execute("apply", { id: "recoverable" }, undefined, undefined, context),
      /dirty paths/,
    );
    const diff = await tools.get("get_agent_diff").execute("diff", { id: "recoverable" }, undefined, undefined, context);
    assert.match(diff.content[0].text, /worker/);

    await writeFile(join(root, "base.txt"), "base\n");
    await tools.get("discard_agent_worktree").execute("discard", { id: "recoverable" }, undefined, undefined, context);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await Promise.all([rm(root, { recursive: true, force: true }), rm(agentDir, { recursive: true, force: true })]);
  }
});

test("untrusted output includes bounded stderr evidence", () => {
  const output = untrustedOutput([{
    id: "failed", agent: "reviewer", thinking: "high", status: "error", startedAt: 0, endedAt: 10,
    durationMs: 10, turns: 0, toolCalls: 0, text: "", task: "Review", cwd: process.cwd(), output: "partial",
    stderr: "provider failed", error: "exit", exitCode: 1, truncated: false,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  }]);
  assert.match(output, /partial/);
  assert.match(output, /\[stderr\]\nprovider failed/);
});

test("subagent tools stay disabled in children", () => {
  const original = process.env.PI_CONFIG_SUBAGENT_CHILD;
  try {
    process.env.PI_CONFIG_SUBAGENT_CHILD = "1";
    const tools = [];
    subagentsExtension({ registerTool(tool) { tools.push(tool.name); } });
    assert.deepEqual(tools, []);
  } finally {
    if (original === undefined) delete process.env.PI_CONFIG_SUBAGENT_CHILD; else process.env.PI_CONFIG_SUBAGENT_CHILD = original;
  }
});
