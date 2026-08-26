import test from "node:test";
import assert from "node:assert/strict";
import { Container, Text } from "@earendil-works/pi-tui";
import ui, { formatElapsed, supportsFastMode } from "../extensions/ui.ts";

function baseTheme() {
  const getFgAnsi = (color) => `\x1b[38;5;${color === "thinkingHigh" ? 2 : 1}m`;
  return {
    getFgAnsi,
    fg: (color, text) => `${getFgAnsi(color)}${text}`,
  };
}

test("response durations hide zero and use compact units", () => {
  assert.equal(formatElapsed(999), "");
  assert.equal(formatElapsed(1_000), "1s");
  assert.equal(formatElapsed(61_000), "1m 1s");
  assert.equal(formatElapsed(3_661_000), "1h 1m 1s");
});

test("fast mode is limited to official OpenAI GPT-5.6 APIs", () => {
  assert.equal(supportsFastMode({ provider: "openai-codex", id: "gpt-5.6-sol", api: "openai-codex-responses" }), true);
  assert.equal(supportsFastMode({ provider: "openai", id: "gpt-5.6-terra", api: "openai-responses" }), true);
  assert.equal(supportsFastMode({ provider: "openai", id: "gpt-5.5", api: "openai-responses" }), false);
  assert.equal(supportsFastMode({ provider: "openrouter", id: "gpt-5.6-sol", api: "openai-responses" }), false);
});

test("fast mode restores per session and adds the priority service tier", async () => {
  const handlers = new Map();
  const commands = new Map();
  const entries = [];
  ui({
    appendEntry: (customType, data) => entries.push({ customType, data }),
    on: (event, handler) => handlers.set(event, handler),
    registerCommand: (name, command) => commands.set(name, command),
  });

  const model = { provider: "openai-codex", id: "gpt-5.6-sol", api: "openai-codex-responses" };
  handlers.get("session_start")({}, {
    mode: "print",
    sessionManager: {
      getBranch: () => [{ type: "custom", customType: "ui-fast-mode", data: { enabled: true } }],
    },
  });

  const payload = { model: model.id, input: [] };
  assert.deepEqual(handlers.get("before_provider_request")({ payload }, { model }), {
    ...payload,
    service_tier: "priority",
  });
  assert.equal("service_tier" in payload, false);

  const notifications = [];
  await commands.get("fast").handler("off", {
    model,
    ui: { notify: (message, level) => notifications.push({ message, level }) },
  });
  assert.deepEqual(entries, [{ customType: "ui-fast-mode", data: { enabled: false } }]);
  assert.deepEqual(notifications, [{ message: "Fast mode disabled.", level: "info" }]);
  assert.equal(handlers.get("before_provider_request")({ payload }, { model }), undefined);
});

test("thinking changes update only the working indicator", () => {
  const handlers = new Map();
  ui({
    on: (event, handler) => handlers.set(event, handler),
    registerCommand() {},
  });

  const indicators = [];
  const theme = baseTheme();
  const containerRender = Container.prototype.render;
  const textInvalidate = Text.prototype.invalidate;
  const ctx = {
    mode: "tui",
    thinkingLevel: "low",
    sessionManager: { getBranch: () => [] },
    ui: {
      theme,
      setTheme() {
        assert.fail("thinking changes must not invalidate the transcript theme");
      },
      setWorkingIndicator: (next) => indicators.push(next),
      setFooter() {},
      setEditorComponent() {},
    },
  };

  handlers.get("session_start")({}, ctx);
  handlers.get("thinking_level_select")({ level: "high" }, ctx);
  handlers.get("thinking_level_select")({ level: "high" }, ctx);

  assert.equal(Container.prototype.render, containerRender);
  assert.equal(Text.prototype.invalidate, textInvalidate);
  assert.equal(indicators.length, 2);
  assert.equal(indicators[1].intervalMs, 80);
  assert.equal(indicators[1].frames.length, 10);
  assert.equal(indicators[1].frames[0], theme.fg("thinkingHigh", "⠋"));
});
