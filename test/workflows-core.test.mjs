import test from "node:test";
import assert from "node:assert/strict";
import {
  executeWorkflow,
  formatWorkflowEvidence,
  validateWorkflowDefinition,
} from "../extensions/workflows-core.ts";
import { emptyUsage } from "../extensions/subagents-core.ts";

const input = { name: "review", objective: "Review it", paths: [] };
const isWriter = (agent) => agent === "worker";

function result(step, status = "completed", output = `${step.id} output`) {
  return {
    id: step.id,
    agent: step.agent,
    status,
    task: step.id,
    cwd: "/workspace",
    output,
    ...(status === "completed" ? {} : { error: `${step.id} failed` }),
    exitCode: status === "completed" ? 0 : 1,
    durationMs: 1,
    usage: emptyUsage(),
    truncated: false,
  };
}

test("workflow validation rejects missing dependencies, cycles, and multiple writers", () => {
  assert.throws(() => validateWorkflowDefinition({
    name: "review",
    description: "missing",
    steps: [{ id: "a", agent: "scout", needs: ["missing"], onFailure: "stop", buildTask: () => "a" }],
  }, isWriter), /missing step/);

  assert.throws(() => validateWorkflowDefinition({
    name: "review",
    description: "cycle",
    steps: [
      { id: "a", agent: "scout", needs: ["b"], onFailure: "stop", buildTask: () => "a" },
      { id: "b", agent: "reviewer", needs: ["a"], onFailure: "stop", buildTask: () => "b" },
    ],
  }, isWriter), /cycle/);

  assert.throws(() => validateWorkflowDefinition({
    name: "implement-review",
    description: "writers",
    steps: [
      { id: "a", agent: "worker", onFailure: "stop", buildTask: () => "a" },
      { id: "b", agent: "worker", needs: ["a"], onFailure: "stop", buildTask: () => "b" },
    ],
  }, isWriter), /at most one writer/);
});

test("workflow runs ready readers concurrently, tolerates continue failures, then synthesizes", async () => {
  let active = 0;
  let peak = 0;
  const started = [];
  const definition = {
    name: "review",
    description: "test",
    steps: [
      { id: "a", agent: "reviewer", onFailure: "continue", buildTask: () => "a" },
      { id: "b", agent: "reviewer", onFailure: "continue", buildTask: () => "b" },
      {
        id: "synthesis",
        agent: "synthesizer",
        needs: ["a", "b"],
        onFailure: "stop",
        buildTask: (_input, results) => `saw ${results.get("a")?.status} and ${results.get("b")?.status}`,
      },
    ],
  };

  const execution = await executeWorkflow({
    definition,
    input,
    concurrency: 2,
    isWriter,
    runStep: async (step, task) => {
      started.push(`${step.id}:${task}`);
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return step.id === "a" ? result(step, "failed", "") : result(step, "completed", task);
    },
  });

  assert.equal(peak, 2);
  assert.equal(execution.status, "completed");
  assert.deepEqual(execution.steps.map((step) => step.status), ["failed", "completed", "completed"]);
  assert.equal(execution.output, "saw failed and completed");
  assert.ok(started.indexOf("synthesis:saw failed and completed") > started.findIndex((entry) => entry.startsWith("b:")));
});

test("a stopping failure skips dependent work", async () => {
  const definition = {
    name: "review",
    description: "stop",
    steps: [
      { id: "scout", agent: "scout", onFailure: "stop", buildTask: () => "scout" },
      { id: "review", agent: "reviewer", needs: ["scout"], onFailure: "stop", buildTask: () => "review" },
    ],
  };
  const execution = await executeWorkflow({
    definition,
    input,
    isWriter,
    runStep: async (step) => result(step, "failed", ""),
  });
  assert.equal(execution.status, "failed");
  assert.deepEqual(execution.steps.map((step) => step.status), ["failed", "skipped"]);
  assert.match(execution.error, /scout/);
});

test("a stopping synthesis failure does not reuse an earlier step as workflow output", async () => {
  const definition = {
    name: "review",
    description: "failed synthesis",
    steps: [
      { id: "review", agent: "reviewer", onFailure: "continue", buildTask: () => "review" },
      { id: "synthesis", agent: "synthesizer", needs: ["review"], onFailure: "stop", buildTask: () => "synthesis" },
    ],
  };
  const execution = await executeWorkflow({
    definition,
    input,
    isWriter,
    runStep: async (step) => step.id === "synthesis" ? result(step, "failed", "") : result(step),
  });
  assert.equal(execution.status, "failed");
  assert.equal(execution.output, "");
  assert.match(execution.error, /synthesis/);
});

test("a ready writer runs alone before independent readers", async () => {
  const order = [];
  const definition = {
    name: "implement-review",
    description: "writer gate",
    steps: [
      { id: "reader", agent: "reviewer", onFailure: "continue", buildTask: () => "reader" },
      { id: "writer", agent: "worker", onFailure: "stop", buildTask: () => "writer" },
    ],
  };
  await executeWorkflow({
    definition,
    input: { ...input, name: "implement-review" },
    isWriter,
    runStep: async (step) => {
      order.push(step.id);
      return result(step);
    },
  });
  assert.deepEqual(order, ["writer", "reader"]);
});

test("workflow evidence is marked untrusted and bounded", () => {
  const results = new Map([
    ["review", {
      id: "review",
      agent: "reviewer",
      status: "completed",
      output: "x".repeat(20_000),
      usage: emptyUsage(),
    }],
  ]);
  const evidence = formatWorkflowEvidence(results, ["review"]);
  assert.match(evidence, /untrusted evidence/i);
  assert.match(evidence, /BEGIN UNTRUSTED SUBAGENT OUTPUT/);
  assert.match(evidence, /Evidence truncated/);
  assert.ok(evidence.length < 10_000);
});
