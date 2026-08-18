import test from "node:test";
import assert from "node:assert/strict";
import askExtension from "../extensions/ask.ts";
import goalExtension from "../extensions/goal.ts";
import todoExtension from "../extensions/todo.ts";
import toolsExtension from "../extensions/tools.ts";
import webExtension from "../extensions/web.ts";

function rendererHarness(load) {
  const tools = new Map();
  const lifecycle = new Map();
  let active = ["read"];
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); active.push(tool.name); },
    registerCommand() {},
    registerShortcut() {},
    on(name, handler) { lifecycle.set(name, handler); },
    events: { on() {}, emit() {} },
    appendEntry() {},
    sendMessage() {},
    sendUserMessage() {},
    getActiveTools: () => [...active],
    setActiveTools(names) { active = [...names]; },
  };
  const child = process.env.PI_CONFIG_SUBAGENT_CHILD;
  delete process.env.PI_CONFIG_SUBAGENT_CHILD;
  try { load(pi); }
  finally { if (child !== undefined) process.env.PI_CONFIG_SUBAGENT_CHILD = child; }
  return { tools, lifecycle };
}

test("config tool renderers collapse repeated display-only blank rows without adding a gutter", () => {
  const cases = [
    [askExtension, ["ask_user_question"]],
    [toolsExtension, ["jq"]],
    [webExtension, ["web_search"]],
    [todoExtension, ["todo"]],
    [goalExtension, ["goal_complete", "goal_wait"]],
  ];
  const result = { content: [{ type: "text", text: "one\n\n \n\n\u001b[31mtwo\u001b[0m" }] };
  const theme = { fg: (_color, value) => value, bold: (value) => value };

  for (const [load, names] of cases) {
    const { tools } = rendererHarness(load);
    for (const name of names) {
      const renderer = tools.get(name)?.renderResult;
      assert.equal(typeof renderer, "function", name);
      const component = renderer(result, { expanded: true }, theme, { args: { tasks: [] } });
      const lines = component.render(80).map((line) => line.trimEnd());
      assert.deepEqual(lines, ["one", "", "two"], name);
      assert.equal(lines[0].startsWith(" "), false, `${name} relies on Pi's tool-shell gutter`);
    }
  }
});
