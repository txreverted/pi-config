import test from "node:test";
import assert from "node:assert/strict";
import askExtension from "../extensions/ask.ts";

function setup() {
  const tools = new Map();
  const handlers = new Map();
  let active = ["read", "ask_user_question"];
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    on(event, handler) { handlers.set(event, handler); },
    getActiveTools: () => [...active],
    setActiveTools(names) { active = [...names]; },
  };
  askExtension(pi);
  return { tool: tools.get("ask_user_question"), handlers, active: () => active };
}

test("question tool executes choices and reports cancellation", async () => {
  const { tool } = setup();
  const ctx = {
    hasUI: true,
    ui: {
      select: async (_title, choices) => choices[0],
      editor: async () => "custom",
    },
  };
  const answered = await tool.execute("call", {
    questions: [{ id: "scope", question: "Scope?", options: [{ label: "Small" }, { label: "Large" }] }],
  }, undefined, undefined, ctx);
  assert.match(answered.content[0].text, /Answer: Small/);
  assert.equal(answered.details.cancelled, false);

  ctx.ui.select = async () => undefined;
  const cancelled = await tool.execute("call", {
    questions: [{ id: "scope", question: "Scope?", options: [{ label: "Small" }, { label: "Large" }] }],
  }, undefined, undefined, ctx);
  assert.equal(cancelled.details.cancelled, true);
  assert.deepEqual(cancelled.details.answers, []);
});

test("question tool rejects non-UI execution and removes itself from non-UI sessions", async () => {
  const { tool, handlers, active } = setup();
  await assert.rejects(
    () => tool.execute("call", { questions: [{ id: "scope", question: "Scope?" }] }, undefined, undefined, { hasUI: false }),
    /requires an interactive/,
  );
  handlers.get("session_start")({}, { hasUI: false });
  assert.deepEqual(active(), ["read"]);
});
