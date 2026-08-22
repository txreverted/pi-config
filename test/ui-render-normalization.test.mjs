import test from "node:test";
import assert from "node:assert/strict";
import askExtension from "../extensions/ask.ts";

function rendererHarness(load) {
  const tools = new Map();
  let active = ["read"];
  load({
    registerTool(tool) { tools.set(tool.name, tool); active.push(tool.name); },
    on() {},
    getActiveTools: () => [...active],
    setActiveTools(names) { active = [...names]; },
  });
  return tools;
}

test("the ask renderer collapses repeated display-only blank rows without adding a gutter", () => {
  const name = "ask_user_question";
  const renderer = rendererHarness(askExtension).get(name)?.renderResult;
  assert.equal(typeof renderer, "function", name);

  const result = { content: [{ type: "text", text: "one\n\n \n\n\u001b[31mtwo\u001b[0m" }] };
  const theme = { fg: (_color, value) => value, bold: (value) => value };
  const component = renderer(result, { expanded: true }, theme, { args: {} });
  const lines = component.render(80).map((line) => line.trimEnd());
  assert.deepEqual(lines, ["one", "", "two"], name);
  assert.equal(lines[0].startsWith(" "), false, `${name} relies on Pi's tool-shell gutter`);
});
