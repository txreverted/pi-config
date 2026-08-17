import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import uiExtension from "../extensions/ui.ts";
import {
  UI_MODE_STATUS_EVENT,
  UI_PANEL_EVENT,
  UI_WIDGET_NAME,
  isVisuallyBlank,
} from "../extensions/ui-core.ts";

const theme = { fg: (_color, value) => value, bold: (value) => value };

function harness() {
  const lifecycle = new Map();
  const bus = new Map();
  const widgets = new Map();
  const unrelatedCalls = [];
  const pi = {
    on(name, handler) { lifecycle.set(name, handler); },
    events: {
      on(name, handler) { bus.set(name, handler); },
      emit(name, data) { bus.get(name)?.(data); },
    },
  };
  const context = {
    mode: "tui",
    ui: {
      setWidget(name, factory, options) {
        if (factory) widgets.set(name, { factory, options });
        else widgets.delete(name);
      },
      setHeader(...args) { unrelatedCalls.push(["header", ...args]); },
      setFooter(...args) { unrelatedCalls.push(["footer", ...args]); },
      setEditorComponent(...args) { unrelatedCalls.push(["editor", ...args]); },
    },
  };
  const tui = { terminal: { rows: 24, columns: 100 }, requestRender() {} };
  uiExtension(pi);
  lifecycle.get("session_start")({}, context);
  return { pi, lifecycle, context, tui, widgets, unrelatedCalls };
}

test("UI extension preserves Pi defaults and composes only approved panels and modes", () => {
  const h = harness();
  assert.deepEqual(h.unrelatedCalls, []);
  h.pi.events.emit(UI_MODE_STATUS_EVENT, { id: "ponytail", text: "ponytail: full (idle)" });
  h.pi.events.emit(UI_MODE_STATUS_EVENT, { id: "goal", text: "goal: active" });
  h.pi.events.emit(UI_PANEL_EVENT, { id: "todo", render: () => ["Todos", "", " ├─ ■ Work"] });
  h.pi.events.emit(UI_PANEL_EVENT, { id: "subagents", render: () => ["ignored"] });

  const widget = h.widgets.get(UI_WIDGET_NAME);
  assert.equal(widget.options.placement, "aboveEditor");
  const lines = widget.factory(h.tui, theme).render(100);
  assert.deepEqual(lines, [
    " Todos",
    " ",
    "  ├─ ■ Work",
    " ",
    " goal: active | ponytail: full (idle)",
    " ",
  ]);
  assert.ok(lines.every((line) => visibleWidth(line) <= 100));
  for (let index = 1; index < lines.length; index++) {
    assert.equal(isVisuallyBlank(lines[index - 1]) && isVisuallyBlank(lines[index]), false);
  }
});

test("UI extension clears its single widget on shutdown", () => {
  const h = harness();
  h.pi.events.emit(UI_MODE_STATUS_EVENT, { id: "goal", text: "goal: active" });
  assert.equal(h.widgets.size, 1);
  h.lifecycle.get("session_shutdown")({}, h.context);
  assert.equal(h.widgets.size, 0);
});
