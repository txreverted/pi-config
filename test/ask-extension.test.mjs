import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, estimateTokens } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { ASK_LIMITS, CUSTOM_ANSWER_LIMIT_TEXT } from "../extensions/ask-core.ts";
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

test("ask tool exposes a bounded schema and compact prompt metadata", () => {
  const { tool } = setup();
  assert.equal(tool.executionMode, "sequential");
  assert.match(tool.description, /Other answers limited to 400 lines or 2,000 UTF-8 bytes/);
  assert.equal(tool.promptGuidelines.length, 2);
  assert.match(tool.promptGuidelines[0], /Inspect available evidence first/);
  assert.match(tool.promptGuidelines[1], /safe reversible default for trivial uncertainty/);
  const metadata = JSON.stringify({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    promptSnippet: tool.promptSnippet,
    promptGuidelines: tool.promptGuidelines,
  });
  const tokens = estimateTokens({ role: "user", content: [{ type: "text", text: metadata }], timestamp: 0 });
  assert.ok(tokens <= 400, `ask metadata estimate ${tokens} exceeds 400 tokens`);
  assert.equal(Value.Check(tool.parameters, input()), true);
  assert.equal(Value.Check(tool.parameters, input({ multiSelect: undefined })), false);
  assert.equal(Value.Check(tool.parameters, input({ options: [{ label: "One", description: "Only" }] })), false);
  assert.equal(Value.Check(tool.parameters, { questions: Array.from({ length: 5 }, () => input().questions[0]) }), false);
  assert.equal(Value.Check(tool.parameters, { ...input(), extra: true }), false);
});

test("TUI single choice pauses for review and returns the selected label", async () => {
  const { tool } = setup();
  const calls = [];
  const result = await tool.execute("call", input(), undefined, undefined, {
    mode: "tui",
    hasUI: true,
    ui: {
      select: async (title, choices) => {
        calls.push({ title, choices });
        return calls.length === 1 ? choices[0] : choices.at(-1);
      },
    },
  });

  assert.equal(calls[0].choices[0], "□ 1. Small │ Smallest useful change");
  assert.equal(calls[1].title, "Review answers");
  assert.match(result.content[0].text, /Answer: Small/);
  assert.deepEqual(result.details.answers[0].optionIndexes, [1]);
  assert.equal(result.details.cancelled, false);
});

test("RPC supports multi-select and an automatic custom answer", async () => {
  const { tool } = setup();
  let selection = 0;
  let placeholder;
  const result = await tool.execute("call", input({ multiSelect: true }), undefined, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: {
      select: async (_title, choices) => {
        selection++;
        if (selection === 1) return choices[0];
        if (selection === 2) {
          assert.equal(choices[0], "■ 1. Small │ Smallest useful change");
          return choices.at(-2);
        }
        if (selection === 3) assert.equal(choices.at(-2), "■ Other");
        return choices.at(-1);
      },
      input: async (_prompt, shownPlaceholder) => {
        placeholder = shownPlaceholder;
        return "Also mobile";
      },
    },
  });

  assert.equal(result.details.answers[0].answer, "Small, Also mobile");
  assert.deepEqual(result.details.answers[0].optionIndexes, [1]);
  assert.equal(result.details.answers[0].custom, true);
  assert.equal(placeholder, `Up to ${CUSTOM_ANSWER_LIMIT_TEXT}`);
});

test("four maximum-size valid custom answers remain visible in runtime output", async () => {
  const { tool } = setup();
  const questions = Array.from({ length: ASK_LIMITS.questions.max }, (_unused, index) => ({
    header: `Scope ${index + 1}`,
    question: `Which scope ${index + 1}?`,
    options: [
      { label: "Small", description: "Smallest useful change" },
      { label: "Complete", description: "All requested behavior" },
    ],
    multiSelect: false,
  }));
  const maximumAnswers = questions.map((_question, index) => {
    const marker = `answer-${index + 1}-`;
    const firstLine = marker + "x".repeat(1_202 - marker.length);
    return `${firstLine}\n${Array.from({ length: ASK_LIMITS.customAnswerLines - 1 }, () => "x").join("\n")}`;
  });
  let answerIndex = 0;
  const result = await tool.execute("call", { questions }, undefined, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: {
      select: async (_title, choices) => choices.at(-1),
      input: async () => maximumAnswers[answerIndex++],
    },
  });

  const output = result.content[0].text;
  assert.equal(result.details.answers.length, ASK_LIMITS.questions.max);
  for (let index = 1; index <= ASK_LIMITS.questions.max; index++) {
    assert.match(output, new RegExp(`- Which scope ${index}\\?`));
    assert.match(output, new RegExp(`answer-${index}-`));
    assert.equal(Buffer.byteLength(result.details.answers[index - 1].answer, "utf8"), ASK_LIMITS.customAnswerBytes);
    assert.equal(result.details.answers[index - 1].answer.split("\n").length, ASK_LIMITS.customAnswerLines);
  }
  assert.doesNotMatch(output, /\[Answer truncated to the ask tool limit:/);
  assert.doesNotMatch(output, /\[Clarification answers truncated/);
  assert.ok(Buffer.byteLength(output, "utf8") <= DEFAULT_MAX_BYTES);
  assert.ok(output.split("\n").length <= DEFAULT_MAX_LINES);
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
        if (step === 4) {
          assert.equal(choices[0], "■ 1. Small │ Smallest useful change");
          return choices[1];
        }
        return choices.at(-1);
      },
    },
  });
  assert.deepEqual(result.details.answers.map(({ answer }) => answer), ["Complete", "Web"]);
});

test("native dialogs clear a blank custom revision and wait for a valid answer", async () => {
  const { tool } = setup();
  let step = 0;
  let inputStep = 0;
  let choicesAfterBlank;
  const result = await tool.execute("call", input(), undefined, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: {
      select: async (_title, choices) => {
        step++;
        if (step === 1) return choices.at(-1);
        if (step === 2) return choices[0];
        if (step === 3) return choices.at(-1);
        if (step === 4) {
          choicesAfterBlank = choices;
          return choices[0];
        }
        return choices.at(-1);
      },
      input: async () => ++inputStep === 1 ? "custom answer" : "   ",
    },
  });

  assert.equal(choicesAfterBlank.at(-1), "□ Other");
  assert.equal(result.details.answers[0].answer, "Small");
  assert.equal(result.details.answers[0].custom, false);
});

test("native dialog text and custom answers are sanitized", async () => {
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

test("malformed native custom answers are rejected", async () => {
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

test("cancelling Other input drops partial answers in both interactive modes", async () => {
  for (const mode of ["tui", "rpc"]) {
    const { tool } = setup();
    const cancelled = await tool.execute("call", input(), undefined, undefined, {
      mode,
      hasUI: true,
      ui: {
        select: async (_title, choices) => choices.at(-1),
        input: async () => undefined,
      },
    });
    assert.equal(cancelled.details.cancelled, true);
    assert.deepEqual(cancelled.details.answers, []);
  }
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
      select: async (_title, _choices, options) => await new Promise((resolve) => {
        options.signal.addEventListener("abort", () => resolve(undefined), { once: true });
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
