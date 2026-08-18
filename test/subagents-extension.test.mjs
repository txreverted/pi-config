import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import subagentsExtension from "../extensions/subagents/index.ts";
import subagentChildExtension from "../extensions/subagents/child.ts";

function harness() {
  const tools = new Map();
  const commands = new Map();
  const events = new Map();
  const bus = new Map();
  const emitted = [];
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
    on(name, handler) { events.set(name, handler); },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    events: {
      on(name, handler) { bus.set(name, handler); },
      emit(name, value) { emitted.push({ name, value }); bus.get(name)?.(value); },
    },
  };
  return { pi, tools, commands, events, emitted };
}

test("subagent extension exposes one parallel batch and one patch lifecycle tool", () => {
  const h = harness();
  subagentsExtension(h.pi);
  assert.deepEqual([...h.tools.keys()], ["parallel_agents", "agent_patch"]);
  assert.deepEqual([...h.commands.keys()], ["agents"]);
  const schema = h.tools.get("parallel_agents").parameters;
  assert.equal(schema.properties.tasks.minItems, 2);
  assert.equal(schema.properties.tasks.maxItems, 6);
  assert.equal(schema.properties.maxConcurrency.maximum, 3);
  assert.match(h.tools.get("parallel_agents").promptGuidelines.join("\n"), /parent remains responsible/i);
  assert.equal(h.tools.get("parallel_agents").executionMode, "sequential");
  assert.equal(h.tools.get("agent_patch").parameters.properties.offset.minimum, 0);
  assert.ok(h.tools.get("agent_patch").parameters.properties.limit.maximum < 50 * 1024);
});

test("top-level subagent tools stay disabled in child processes", () => {
  const previous = process.env.PI_CONFIG_SUBAGENT_CHILD;
  process.env.PI_CONFIG_SUBAGENT_CHILD = "1";
  try {
    const h = harness();
    subagentsExtension(h.pi);
    assert.equal(h.tools.size, 0);
  } finally {
    if (previous === undefined) delete process.env.PI_CONFIG_SUBAGENT_CHILD;
    else process.env.PI_CONFIG_SUBAGENT_CHILD = previous;
  }
});

test("child extension provides structured completion and blocks workspace escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-config-subagent-child-"));
  const previous = {
    child: process.env.PI_CONFIG_SUBAGENT_CHILD,
    role: process.env.PI_CONFIG_AGENT_ROLE,
    workspace: process.env.PI_CONFIG_AGENT_WORKSPACE,
    cwd: process.env.PI_CONFIG_AGENT_CWD,
    writable: process.env.PI_CONFIG_AGENT_WRITABLE,
  };
  Object.assign(process.env, {
    PI_CONFIG_SUBAGENT_CHILD: "1",
    PI_CONFIG_AGENT_ROLE: "worker",
    PI_CONFIG_AGENT_WORKSPACE: root,
    PI_CONFIG_AGENT_CWD: root,
    PI_CONFIG_AGENT_WRITABLE: "1",
  });
  try {
    const h = harness();
    subagentChildExtension(h.pi);
    assert.deepEqual([...h.tools.keys()], ["agent_result"]);
    await h.events.get("session_start")();
    const completed = await h.tools.get("agent_result").execute("id", { status: "succeeded", summary: "Done", evidence: ["file"] });
    assert.equal(completed.terminate, true);
    assert.equal(completed.details.agentResult.summary, "Done");
    await assert.rejects(
      () => h.tools.get("agent_result").execute("id", { status: "blocked", summary: "Need input", evidence: [] }),
      /require a question/,
    );
    const blocked = await h.events.get("tool_call")({ toolName: "write", toolCallId: "w", input: { path: "../escape" } }, {
      sessionManager: { getBranch: () => [] },
    });
    assert.match(blocked.reason, /worktree/);
    const gitBlocked = await h.events.get("tool_call")({ toolName: "write", toolCallId: "g", input: { path: ".git" } }, {
      sessionManager: { getBranch: () => [] },
    });
    assert.match(gitBlocked.reason, /Git metadata/);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      const envName = { child: "PI_CONFIG_SUBAGENT_CHILD", role: "PI_CONFIG_AGENT_ROLE", workspace: "PI_CONFIG_AGENT_WORKSPACE", cwd: "PI_CONFIG_AGENT_CWD", writable: "PI_CONFIG_AGENT_WRITABLE" }[name];
      if (value === undefined) delete process.env[envName];
      else process.env[envName] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
