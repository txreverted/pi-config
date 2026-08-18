import test from "node:test";
import assert from "node:assert/strict";
import { Value } from "typebox/value";
import askExtension from "../extensions/ask.ts";

const input = (overrides = {}) => ({
  questions: [{
    header: "Scope",
    question: "Which scope?",
    options: [
      { label: "Small", description: "Smallest useful change" },
      { label: "Complete", description: "All requested behavior" },
    ],
    multiSelect: false,
    ...overrides,
  }],
});

function setup() {
  const tools = new Map();
  const events = new Map();
  let active = ["read", "ask_user_question"];
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    on(name, handler) { events.set(name, handler); },
    getActiveTools: () => [...active],
    setActiveTools(names) { active = [...names]; },
  };
  askExtension(pi);
  return { tool: tools.get("ask_user_question"), events, active: () => active };
}

test("ask tool exposes the bounded Claude-like schema", () => {
  const { tool } = setup();
  assert.equal(tool.executionMode, "sequential");
  assert.equal(Value.Check(tool.parameters, input()), true);
  assert.equal(Value.Check(tool.parameters, input({ multiSelect: undefined })), false);
  assert.equal(Value.Check(tool.parameters, input({ options: [{ label: "One", description: "Only" }] })), false);
  assert.equal(Value.Check(tool.parameters, { questions: Array.from({ length: 5 }, () => input().questions[0]) }), false);
  assert.equal(Value.Check(tool.parameters, { ...input(), extra: true }), false);
});

test("TUI single choice pauses for review and returns the selected label", async () => {
  const { tool } = setup();
  const theme = { fg: (_color, text) => text, bold: (text) => text };
  const keybindings = { matches: (data, action) => data === "\r" && action === "tui.select.confirm" };
  const result = await tool.execute("call", input(), undefined, undefined, {
    mode: "tui",
    hasUI: true,
    ui: {
      custom: async (factory) => {
        let completed;
        const component = factory({ terminal: { rows: 30, columns: 80 }, requestRender() {} }, theme, keybindings, (value) => { completed = value; });
        component.handleInput("\r");
        component.handleInput("\r");
        return completed;
      },
    },
  });

  assert.match(result.content[0].text, /Answer: Small/);
  assert.deepEqual(result.details.answers[0].optionIndexes, [1]);
  assert.equal(result.details.cancelled, false);
});

test("RPC supports multi-select and an automatic custom answer", async () => {
  const { tool } = setup();
  let selection = 0;
  const result = await tool.execute("call", input({ multiSelect: true }), undefined, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: {
      select: async (_title, choices) => {
        selection++;
        if (selection === 1) return choices[0];
        if (selection === 2) return choices.at(-2);
        return choices.at(-1);
      },
      input: async () => "Also mobile",
    },
  });

  assert.equal(result.details.answers[0].answer, "Small, Also mobile");
  assert.deepEqual(result.details.answers[0].optionIndexes, [1]);
  assert.equal(result.details.answers[0].custom, true);
});

test("RPC review can revise an earlier answer", async () => {
  const { tool } = setup();
  const questions = [
    input().questions[0],
    {
      header: "Target",
      question: "Which target?",
      options: [
        { label: "Web", description: "Browser" },
        { label: "CLI", description: "Terminal" },
      ],
      multiSelect: false,
    },
  ];
  let step = 0;
  const result = await tool.execute("call", { questions }, undefined, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: {
      select: async (_title, choices) => {
        step++;
        if (step <= 2) return choices[0];
        if (step === 3) return choices[0];
        if (step === 4) return choices[1];
        return choices.at(-1);
      },
    },
  });
  assert.deepEqual(result.details.answers.map(({ answer }) => answer), ["Complete", "Web"]);
});

test("RPC display and custom answers are sanitized", async () => {
  const { tool } = setup();
  let shownTitle;
  let shownChoices;
  const result = await tool.execute("call", input({
    header: " Scope\u001b[31m ",
    question: "Choose\u202e?",
    options: [
      { label: "Small\u001b]0;x\u0007", description: "Few\nchanges" },
      { label: "Complete", description: "Everything" },
    ],
  }), undefined, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: {
      select: async (title, choices) => {
        shownTitle ??= title;
        shownChoices ??= choices;
        return choices.at(-1);
      },
      input: async () => "custom\u001b]52;c;payload\u0007\nanswer",
    },
  });

  assert.equal(shownTitle, "1/1 │ Scope: Choose?");
  assert.equal(shownChoices[0], "□ 1. Small │ Few changes");
  assert.equal(result.details.answers[0].answer, "custom\nanswer");
  assert.doesNotMatch(result.content[0].text, /[\u001b\u0007\u202e]/);
});

test("malformed RPC custom answers are rejected", async () => {
  const { tool } = setup();
  await assert.rejects(() => tool.execute("call", input(), undefined, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: {
      select: async (_title, choices) => choices.at(-1),
      input: async () => ({ answer: "invalid" }),
    },
  }), /invalid custom answer/);
});

test("cancellation returns no partial answers and headless sessions disable the tool", async () => {
  const { tool, events, active } = setup();
  const cancelled = await tool.execute("call", input(), undefined, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: { select: async () => undefined },
  });
  assert.equal(cancelled.details.cancelled, true);
  assert.deepEqual(cancelled.details.answers, []);
  assert.match(cancelled.content[0].text, /Do not infer/);

  await assert.rejects(() => tool.execute("call", input(), undefined, undefined, { mode: "print", hasUI: false }), /requires an interactive/);
  events.get("session_start")({}, { mode: "print" });
  assert.deepEqual(active(), ["read"]);
});

test("an active TUI ask aborts without returning partial answers", async () => {
  const { tool } = setup();
  const controller = new AbortController();
  const result = await tool.execute("call", input(), controller.signal, undefined, {
    mode: "tui",
    hasUI: true,
    ui: {
      custom: async (factory) => await new Promise((resolve) => {
        factory(
          { terminal: { rows: 30, columns: 80 }, requestRender() {} },
          { fg: (_color, text) => text, bold: (text) => text },
          { matches: () => false },
          resolve,
        );
        controller.abort();
      }),
    },
  });
  assert.equal(result.details.cancelled, true);
  assert.deepEqual(result.details.answers, []);
});

test("an already aborted ask does not open UI", async () => {
  const { tool } = setup();
  const controller = new AbortController();
  controller.abort();
  let opened = false;
  const result = await tool.execute("call", input(), controller.signal, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: { select: async () => { opened = true; } },
  });
  assert.equal(opened, false);
  assert.equal(result.details.cancelled, true);
});
