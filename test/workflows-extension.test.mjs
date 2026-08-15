import test from "node:test";
import assert from "node:assert/strict";
import { registerWorkflowTool } from "../extensions/workflows.ts";

function setup({ confirmed = true } = {}) {
  const tools = new Map();
  const starts = [];
  const pi = { registerTool(tool) { tools.set(tool.name, tool); } };
  const runtime = {
    bind() {},
    async startBackgroundWorkflow(options) {
      starts.push(options);
      return { runId: "review-test-run", name: options.builtinName, status: "starting", statePath: "/tmp/state.json" };
    },
  };
  registerWorkflowTool(pi, runtime);
  const ctx = {
    cwd: "/workspace",
    hasUI: true,
    model: { provider: "fixture", id: "model", reasoning: true },
    ui: { confirm: async () => confirmed },
  };
  return { tool: tools.get("workflow"), starts, ctx };
}

test("workflow exposes only built-in background graphs", () => {
  const { tool } = setup();
  assert.ok(tool);
  assert.deepEqual(tool.parameters.required.sort(), ["name", "objective"]);
  assert.equal(tool.parameters.additionalProperties, false);
  assert.equal("spec" in tool.parameters.properties, false);
  assert.equal("background" in tool.parameters.properties, false);
});

test("workflow starts read-only graphs and gates the built-in writer", async () => {
  const { tool, starts, ctx } = setup();
  const review = await tool.execute("call", { name: "review", objective: "Review" }, undefined, undefined, ctx);
  assert.match(review.content[0].text, /started in the background/);
  assert.equal(starts[0].builtinName, "review");

  await assert.rejects(
    () => tool.execute("call", { name: "implement-review", objective: "Implement" }, undefined, undefined, ctx),
    /allowWrite/,
  );

  const refused = setup({ confirmed: false });
  await assert.rejects(
    () => refused.tool.execute("call", { name: "implement-review", objective: "Implement", allowWrite: true }, undefined, undefined, refused.ctx),
    /not approved/,
  );

  await tool.execute("call", { name: "implement-review", objective: "Implement", allowWrite: true }, undefined, undefined, ctx);
  assert.equal(starts.at(-1).builtinName, "implement-review");
  assert.equal("definition" in starts.at(-1), false);
});
