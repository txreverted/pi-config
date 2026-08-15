import test from "node:test";
import assert from "node:assert/strict";
import uiExtension from "../extensions/ui.ts";

function theme() {
  return {
    fg: (_color, value) => value,
    bold: (value) => value,
  };
}

test("status widget renders unknown context honestly and caches unchanged session cost", () => {
  const handlers = new Map();
  let widgetFactory;
  let entryReads = 0;
  const entries = [{
    type: "message",
    message: { role: "assistant", usage: { cost: { total: 1.25 } } },
  }];
  const pi = { on(event, handler) { handlers.set(event, handler); } };
  uiExtension(pi);
  const ctx = {
    mode: "tui",
    cwd: "/tmp/project",
    model: { id: "model", provider: "fixture", contextWindow: 128_000 },
    thinkingLevel: "high",
    modelRegistry: {
      getProvider: () => undefined,
      isUsingOAuth: () => false,
    },
    sessionManager: {
      getSessionName: () => undefined,
      getEntries() { entryReads++; return entries; },
    },
    getContextUsage: () => undefined,
    ui: {
      setFooter(factory) {
        factory({}, theme(), { getGitBranch: () => "main", onBranchChange: () => () => {} });
      },
      setHeader() {},
      setWidget(_name, factory) { widgetFactory = factory; },
    },
  };

  handlers.get("session_start")({}, ctx);
  const widget = widgetFactory({ requestRender() {} }, theme());
  const first = widget.render(200).join("\n");
  const second = widget.render(200).join("\n");
  assert.match(first, /\?%\/128k/);
  assert.match(first, /\$1\.250/);
  assert.equal(second, first);
  assert.equal(entryReads, 2);

  entries.push({ type: "message", message: { role: "assistant", usage: { cost: { total: 0.75 } } } });
  assert.match(widget.render(200).join("\n"), /\$2\.000/);
  widget.dispose();
  handlers.get("session_shutdown")();
});
