import test from "node:test";
import assert from "node:assert/strict";
import ui from "../extensions/ui.ts";

function baseTheme() {
  return {
    getFgAnsi: (color) => `\x1b[38;5;${color === "thinkingHigh" ? 2 : 1}m`,
    getBgAnsi: () => "\x1b[48;5;0m",
    getColorMode: () => "256color",
  };
}

test("thinking changes recolor the UI and refresh loaded resource labels", () => {
  const handlers = new Map();
  ui({ on: (event, handler) => handlers.set(event, handler) });

  let expanded = false;
  const expansionChanges = [];
  const indicators = [];
  const themes = [];
  const theme = baseTheme();
  const ctx = {
    mode: "tui",
    thinkingLevel: "low",
    ui: {
      theme,
      setTheme: (next) => themes.push(next),
      setWorkingIndicator: (next) => indicators.push(next),
      setFooter() {},
      setEditorComponent() {},
      getToolsExpanded: () => expanded,
      setToolsExpanded(next) {
        if (next === expanded) return;
        expanded = next;
        expansionChanges.push(next);
      },
    },
  };

  handlers.get("session_start")({}, ctx);
  handlers.get("thinking_level_select")({ level: "high" }, ctx);

  assert.equal(themes.length, 2);
  assert.equal(themes[1].getFgAnsi("mdHeading"), theme.getFgAnsi("thinkingHigh"));
  assert.equal(indicators.length, 2);
  assert.equal(indicators[1].intervalMs, 80);
  assert.equal(indicators[1].frames.length, 10);
  assert.equal(indicators[1].frames[0], themes[1].fg("thinkingHigh", "⠋"));
  assert.deepEqual(expansionChanges, [true, false]);
  assert.equal(expanded, false);
});
