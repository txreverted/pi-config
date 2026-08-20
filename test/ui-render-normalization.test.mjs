import test from "node:test";
import assert from "node:assert/strict";
import askExtension from "../extensions/ask.ts";
import webExtension from "../extensions/web.ts";

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

test("config tool renderers collapse repeated display-only blank rows without adding a gutter", () => {
  const cases = [
    [askExtension, ["ask_user_question"]],
    [webExtension, ["web_search"]],
  ];
  const result = { content: [{ type: "text", text: "one\n\n \n\n\u001b[31mtwo\u001b[0m" }] };
  const theme = { fg: (_color, value) => value, bold: (value) => value };

  for (const [load, names] of cases) {
    const tools = rendererHarness(load);
    for (const name of names) {
      const renderer = tools.get(name)?.renderResult;
      assert.equal(typeof renderer, "function", name);
      const component = renderer(result, { expanded: true }, theme, { args: {} });
      const lines = component.render(80).map((line) => line.trimEnd());
      assert.deepEqual(lines, ["one", "", "two"], name);
      assert.equal(lines[0].startsWith(" "), false, `${name} relies on Pi's tool-shell gutter`);
    }
  }
});
