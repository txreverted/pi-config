import test from "node:test";
import assert from "node:assert/strict";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import ui, { compactEmptyLines, formatElapsed, supportsFastMode } from "../extensions/ui.ts";

function baseTheme() {
  return {
    getFgAnsi: (color) => `\x1b[38;5;${color === "thinkingHigh" ? 2 : 1}m`,
    getBgAnsi: () => "\x1b[48;5;0m",
    getColorMode: () => "256color",
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

test("consecutive empty UI lines collapse to one", () => {
  const hiddenMarker = "\x1b]133;B\x07";
  const combinedMarkers = "\x1b]133;B\x1b\\\x1b]133;C\x07";
  assert.deepEqual(compactEmptyLines(["first", "", hiddenMarker, "", "last"]), ["first", hiddenMarker, "last"]);
  assert.deepEqual(compactEmptyLines(["", combinedMarkers, ""]), [combinedMarkers]);
});

test("large styled transcripts retain visible rows", () => {
  const styled = Array.from(
    { length: 1_024 },
    (_, index) => `\x1b[38;5;${index % 256}mline ${index}\x1b[0m`,
  );
  assert.deepEqual(compactEmptyLines(["", ...styled, "", ""]), ["", ...styled, ""]);
});

test("terminal image rows are not collapsed", () => {
  const kittyImage = "\x1b_Ga=T,r=3,i=1;data\x1b\\";
  const iTermImage = "\x1b[2A\x1b]1337;File=inline=1;height=auto:data\x07";
  assert.deepEqual(compactEmptyLines([kittyImage, "", ""]), [kittyImage, "", ""]);
  assert.deepEqual(compactEmptyLines(["", "", iTermImage]), ["", "", iTermImage]);
});

test("thinking changes refresh themed labels without toggling or redundant renders", () => {
  const handlers = new Map();
  ui({
    on: (event, handler) => handlers.set(event, handler),
    registerCommand() {},
  });

  const indicators = [];
  const themes = [];
  const theme = baseTheme();
  let labelRefreshes = 0;
  const label = new Text("", 0, 0);
  label.getCollapsedText = () => themes.at(-1).fg("mdHeading", "[Context]");
  label.getExpandedText = label.getCollapsedText;
  label.setExpanded = () => {
    labelRefreshes++;
    label.setText(label.getCollapsedText());
  };
  const labels = new Container();
  labels.addChild(label);
  const ctx = {
    mode: "tui",
    thinkingLevel: "low",
    sessionManager: { getBranch: () => [] },
    ui: {
      theme,
      setTheme(next) {
        themes.push(next);
        labels.invalidate();
      },
      setWorkingIndicator: (next) => indicators.push(next),
      setFooter() {},
      setEditorComponent() {},
      getToolsExpanded: () => false,
      setToolsExpanded() {
        assert.fail("thinking changes must not toggle expanded output");
      },
    },
  };

  const container = new Container();
  container.addChild({ render: () => ["content"], invalidate() {} });
  container.addChild(new Spacer(2));

  handlers.get("session_start")({}, ctx);
  handlers.get("thinking_level_select")({ level: "high" }, ctx);
  handlers.get("thinking_level_select")({ level: "high" }, ctx);

  assert.deepEqual(container.render(80), ["content", ""]);
  assert.equal(themes.length, 2);
  assert.equal(themes[1].getFgAnsi("mdHeading"), theme.getFgAnsi("thinkingHigh"));
  assert.equal(labelRefreshes, 2);
  assert.match(label.render(80)[0], /\[Context\]/);
  assert.ok(label.render(80)[0].includes(theme.getFgAnsi("thinkingHigh")));
  assert.equal(indicators.length, 2);
  assert.equal(indicators[1].intervalMs, 80);
  assert.equal(indicators[1].frames.length, 10);
  assert.equal(indicators[1].frames[0], themes[1].fg("thinkingHigh", "⠋"));

  handlers.get("session_shutdown")({}, ctx);
  labels.invalidate();
  assert.equal(labelRefreshes, 2);
  assert.deepEqual(container.render(80), ["content", "", ""]);
});
