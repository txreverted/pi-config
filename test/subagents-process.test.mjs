import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChildAgent } from "../extensions/subagents/runner.ts";
import { formatAgentResults } from "../extensions/subagents/ui.ts";

const task = {
  id: "explore",
  role: "explorer",
  title: "Explore",
  objective: "Inspect files",
  contextFiles: [],
  acceptanceCriteria: ["Return evidence"],
  writeScope: [],
};

async function fixture(source) {
  const root = await mkdtemp(join(tmpdir(), "pi-config-subagent-process-"));
  const script = join(root, "fake.mjs");
  await writeFile(script, source);
  return { root, script };
}

test("child runner captures structured completion, progress, and usage", async () => {
  const { root, script } = await fixture(`
const emit = value => process.stdout.write(JSON.stringify(value) + "\\n");
emit({type:"agent_start"});
emit({type:"tool_execution_start",toolCallId:"1",toolName:"read",args:{path:"README.md"}});
emit({type:"tool_execution_end",toolCallId:"1",toolName:"read"});
emit({type:"message_end",message:{role:"assistant",provider:"test",model:"model",stopReason:"stop",usage:{input:10,output:5,cacheRead:0,cacheWrite:0,totalTokens:15,cost:{input:0.1,output:0.2,cacheRead:0,cacheWrite:0,total:0.3}}}});
emit({type:"message_end",message:{role:"toolResult",toolName:"agent_result",details:{agentResult:{status:"succeeded",summary:"Found it",evidence:["README.md"]}}}});
`);
  try {
    const updates = [];
    const result = await runChildAgent({
      task,
      workspace: root,
      model: "test/model",
      thinking: "low",
      prompt: "Inspect",
      systemPrompt: "Role",
      trusted: false,
      invocation: { command: process.execPath, argsPrefix: [script] },
      onUpdate: (update) => updates.push(update),
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.result.summary, "Found it");
    assert.equal(result.toolCalls, 1);
    assert.equal(result.usage.totalTokens, 15);
    assert.equal(result.model, "test/model");
    assert.ok(updates.some((update) => update.activity === "reading README.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("child runner rejects malformed structured completion", async () => {
  const { root, script } = await fixture(`
const emit = value => process.stdout.write(JSON.stringify(value) + "\\n");
emit({type:"agent_start"});
emit({type:"message_end",message:{role:"toolResult",toolName:"agent_result",details:{agentResult:{status:"succeeded",summary:"Missing evidence"}}}});
`);
  try {
    const result = await runChildAgent({
      task,
      workspace: root,
      model: "test/model",
      thinking: "low",
      prompt: "Inspect",
      systemPrompt: "Role",
      trusted: false,
      invocation: { command: process.execPath, argsPrefix: [script] },
    });
    assert.equal(result.status, "failed");
    assert.match(result.error, /Invalid child agentResult.*evidence/);
    assert.doesNotThrow(() => formatAgentResults([result]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an already aborted child run does not spawn", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-config-subagent-pre-abort-"));
  try {
    const controller = new AbortController();
    controller.abort();
    const result = await runChildAgent({
      task,
      workspace: root,
      model: "test/model",
      thinking: "low",
      prompt: "Wait",
      systemPrompt: "Role",
      trusted: false,
      signal: controller.signal,
      invocation: { command: join(root, "must-not-exist"), argsPrefix: [] },
    });
    assert.equal(result.status, "cancelled");
    assert.match(result.error, /before launch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("child runner cancels a silent process and returns a bounded diagnostic", async () => {
  const { root, script } = await fixture(`setInterval(() => {}, 1000);`);
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 40);
    const result = await runChildAgent({
      task,
      workspace: root,
      model: "test/model",
      thinking: "low",
      prompt: "Wait",
      systemPrompt: "Role",
      trusted: false,
      signal: controller.signal,
      startupMs: 5_000,
      invocation: { command: process.execPath, argsPrefix: [script] },
    });
    assert.equal(result.status, "cancelled");
    assert.match(result.error, /cancelled/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("child runner enforces the startup deadline", async () => {
  const { root, script } = await fixture(`setInterval(() => {}, 1000);`);
  try {
    const result = await runChildAgent({
      task,
      workspace: root,
      model: "test/model",
      thinking: "low",
      prompt: "Wait",
      systemPrompt: "Role",
      trusted: false,
      startupMs: 30,
      runtimeMs: 5_000,
      invocation: { command: process.execPath, argsPrefix: [script] },
    });
    assert.equal(result.status, "failed");
    assert.match(result.error, /startup deadline/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
