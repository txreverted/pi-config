import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, estimateTokens, initTheme } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
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

const other = (choices) => choices.find((choice) => choice.endsWith("Other"));
const finish = (choices) => choices.find((choice) => choice === "Submit answers" || choice.startsWith("Done (")) ?? other(choices);

initTheme("dark");
function testUI(ui) {
  return {
    ...ui,
    custom: async (factory) => await new Promise((resolve, reject) => {
      const component = factory(
        { requestRender() {}, terminal: { columns: 80, rows: 24 } },
        undefined, { matches: () => false }, resolve,
      );
      const displayed = stripTerminalSequences(component.render(80).join("\n"));
      Promise.resolve(ui.editor(displayed, "")).then(resolve, reject);
    }),
  };
}

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
  assert.match(tool.description, /Other answers limited to 1 line, up to 2,000 UTF-8 bytes/);
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
    ui: testUI({
      select: async (title, choices) => {
        calls.push({ title, choices });
        return calls.length === 1 ? choices[0] : finish(choices);
      },
    }),
  });

  assert.equal(calls[0].choices[0], "□ 1. Small │ Smallest useful change");
  assert.equal(calls[1].title, "Review answers");
  assert.equal(calls[1].choices[0], "Submit answers");
  assert.equal(calls[1].choices[1], "Edit 1/1 │ Scope: Small");
  assert.match(result.content[0].text, /Answer: Small/);
  assert.deepEqual(result.details.answers[0].optionIndexes, [1]);
  assert.equal(result.details.cancelled, false);
});

test("RPC supports multi-select and an automatic custom answer", async () => {
  const { tool } = setup();
  let selection = 0;
  let editorTitle;
  let prefill;
  const result = await tool.execute("call", input({ multiSelect: true }), undefined, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: testUI({
      select: async (_title, choices) => {
        selection++;
        if (selection === 1) return choices[0];
        if (selection === 2) {
          assert.equal(choices[0], "Done (1 selected)");
          assert.equal(choices[1], "■ 1. Small │ Smallest useful change");
          return other(choices);
        }
        if (selection === 3) assert.equal(other(choices), "■ Other");
        if (selection === 4) assert.equal(choices[1], "Edit 1/1 │ Scope: Small, Also mobile");
        return finish(choices);
      },
      editor: async (prompt, shownPrefill) => {
        editorTitle = prompt;
        prefill = shownPrefill;
        return "Also mobile";
      },
    }),
  });

  assert.equal(result.details.answers[0].answer, "Small, Also mobile");
  assert.deepEqual(result.details.answers[0].optionIndexes, [1]);
  assert.equal(result.details.answers[0].custom, true);
  assert.match(editorTitle, /Which scope\?/);
  assert.ok(editorTitle.includes(CUSTOM_ANSWER_LIMIT_TEXT));
  assert.equal(prefill, "");
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
    return marker + "x".repeat(ASK_LIMITS.customAnswerBytes - marker.length);
  });
  let answerIndex = 0;
  const result = await tool.execute("call", { questions }, undefined, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: testUI({
      select: async (_title, choices) => finish(choices),
      editor: async () => maximumAnswers[answerIndex++],
    }),
  });

  const output = result.content[0].text;
  assert.equal(result.details.answers.length, ASK_LIMITS.questions.max);
  for (let index = 1; index <= ASK_LIMITS.questions.max; index++) {
    assert.match(output, new RegExp(`- Which scope ${index}\\?`));
    assert.match(output, new RegExp(`answer-${index}-`));
    assert.equal(Buffer.byteLength(result.details.answers[index - 1].answer, "utf8"), ASK_LIMITS.customAnswerBytes);
    assert.equal(result.details.answers[index - 1].answer.includes("\n"), false);
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
    ui: testUI({
      select: async (_title, choices) => {
        step++;
        if (step <= 2) return choices[0];
        if (step === 3) return choices[1];
        if (step === 4) {
          assert.equal(choices[0], "■ 1. Small │ Smallest useful change");
          return choices[1];
        }
        assert.deepEqual(choices, ["Submit answers", "Edit 1/2 │ Scope: Complete", "Edit 2/2 │ Target: Web"]);
        return finish(choices);
      },
    }),
  });
  assert.deepEqual(result.details.answers.map(({ answer }) => answer), ["Complete", "Web"]);
});

for (const mode of ["tui", "rpc"]) {
  test(`${mode} review keeps duplicate headers distinct and recomputes revised answers`, async () => {
    const { tool } = setup();
    const questions = [
      input().questions[0],
      { ...input().questions[0], question: "Which additional scope?" },
    ];
    let step = 0;
    const result = await tool.execute("call", { questions }, undefined, undefined, {
      mode,
      hasUI: true,
      ui: testUI({
        select: async (_title, choices) => {
          step++;
          if (step === 1) return choices[0];
          if (step === 2) return choices[1];
          if (step === 3) {
            assert.deepEqual(choices, ["Submit answers", "Edit 1/2 │ Scope: Small", "Edit 2/2 │ Scope: Complete"]);
            return choices[1];
          }
          if (step === 4) return choices[1];
          assert.deepEqual(choices, ["Submit answers", "Edit 1/2 │ Scope: Complete", "Edit 2/2 │ Scope: Complete"]);
          return finish(choices);
        },
      }),
    });
    assert.equal(step, 5);
    assert.deepEqual(result.details.answers.map(({ answer }) => answer), ["Complete", "Complete"]);
  });

  test(`${mode} review sanitizes and bounds Unicode multi-select previews without shortening stored answers`, async () => {
    const { tool } = setup();
    const custom = "🦊".repeat(200);
    let step = 0;
    const result = await tool.execute("call", input({ multiSelect: true }), undefined, undefined, {
      mode,
      hasUI: true,
      ui: testUI({
        editor: async () => `\u001b[31m${custom}\u001b[0m\u202e`,
        select: async (_title, choices) => {
          step++;
          if (step === 1) return choices[1];
          if (step === 2) return choices[1];
          if (step === 3) return other(choices);
          if (step === 4) return finish(choices);
          const preview = choices[1].slice("Edit 1/1 │ Scope: ".length);
          const prefix = "Small, Complete, ";
          assert.equal(preview, prefix + "🦊".repeat(157 - prefix.length) + "...");
          assert.equal(Array.from(preview).length, 160);
          assert.doesNotMatch(preview, /[\u001b\u202e]/);
          return finish(choices);
        },
      }),
    });
    assert.equal(step, 5);
    assert.equal(result.details.answers[0].answer, `Small, Complete, ${custom}`);
    assert.deepEqual(result.details.answers[0].optionIndexes, [1, 2]);
    assert.ok(result.content[0].text.includes(custom));
  });

  test(`${mode} review preserves an exact 160-character preview and discards answers on cancellation`, async () => {
    const { tool } = setup();
    const custom = "界".repeat(160);
    let step = 0;
    const result = await tool.execute("call", input(), undefined, undefined, {
      mode,
      hasUI: true,
      ui: testUI({
        editor: async () => custom,
        select: async (_title, choices) => {
          step++;
          if (step === 1) return finish(choices);
          assert.equal(choices[1], `Edit 1/1 │ Scope: ${custom}`);
          return undefined;
        },
      }),
    });
    assert.equal(step, 2);
    assert.equal(result.details.cancelled, true);
    assert.deepEqual(result.details.answers, []);
    assert.ok(!result.content[0].text.includes(custom));
  });
}

test("native dialogs clear a blank custom revision and wait for a valid answer", async () => {
  const { tool } = setup();
  let step = 0;
  let inputStep = 0;
  let choicesAfterBlank;
  const result = await tool.execute("call", input(), undefined, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: testUI({
      select: async (_title, choices) => {
        step++;
        if (step === 1) return finish(choices);
        if (step === 2) return choices[1];
        if (step === 3) return finish(choices);
        if (step === 4) {
          choicesAfterBlank = choices;
          return choices[0];
        }
        return finish(choices);
      },
      editor: async () => ++inputStep === 1 ? "custom answer" : "   ",
    }),
  });

  assert.equal(other(choicesAfterBlank), "□ Other");
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
    ui: testUI({
      select: async (title, choices) => {
        shownTitle ??= title;
        shownChoices ??= choices;
        return finish(choices);
      },
      editor: async () => "custom\u001b]52;c;payload\u0007\nanswer",
    }),
  });

  assert.equal(shownTitle, "1/1 │ Scope: Choose?");
  assert.equal(shownChoices[0], "□ 1. Small │ Few changes");
  assert.equal(result.details.answers[0].answer, "custom answer");
  assert.doesNotMatch(result.content[0].text, /[\u001b\u0007\u202e]/);
});

test("malformed native custom answers are rejected", async () => {
  const { tool } = setup();
  await assert.rejects(() => tool.execute("call", input(), undefined, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: testUI({
      select: async (_title, choices) => finish(choices),
      editor: async () => ({ answer: "invalid" }),
    }),
  }), /invalid custom answer/);
});

test("cancelling Other input drops partial answers in both interactive modes", async () => {
  for (const mode of ["tui", "rpc"]) {
    const { tool } = setup();
    const cancelled = await tool.execute("call", input(), undefined, undefined, {
      mode,
      hasUI: true,
      ui: testUI({
        select: async (_title, choices) => finish(choices),
        editor: async () => undefined,
      }),
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
    ui: testUI({ select: async () => undefined }),
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
    ui: testUI({
      select: async (_title, _choices, options) => await new Promise((resolve) => {
        options.signal.addEventListener("abort", () => resolve(undefined), { once: true });
        controller.abort();
      }),
    }),
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
    ui: testUI({ select: async () => { opened = true; } }),
  });
  assert.equal(opened, false);
  assert.equal(result.details.cancelled, true);
});

test("RPC preserves oversized drafts for correction and prefills the complete reviewed answer", async () => {
  const { tool } = setup();
  const oversized = "😀".repeat(501);
  const accepted = "x".repeat(180) + " full-answer-tail";
  let selection = 0;
  let editing = 0;
  const result = await tool.execute("call", input(), undefined, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: {
      select: async (_title, choices) => {
        selection++;
        if (selection === 2) return choices[1];
        return finish(choices);
      },
      editor: async (title, prefill) => {
        editing++;
        assert.match(title, /Which scope\?/);
        assert.ok(title.includes(CUSTOM_ANSWER_LIMIT_TEXT));
        if (editing === 1) {
          assert.equal(prefill, "");
          return oversized;
        }
        if (editing === 2) {
          assert.equal(prefill, oversized);
          assert.match(title, /2,004 UTF-8 bytes/);
          assert.match(title, /Shorten the preserved draft/);
          return accepted;
        }
        assert.equal(prefill, accepted);
        return `${prefill} revised`;
      },
    },
  });
  assert.equal(editing, 3);
  assert.equal(selection, 4);
  assert.equal(result.details.answers[0].answer, `${accepted} revised`);
  assert.ok(result.content[0].text.includes(`${accepted} revised`));
});

test("the native TUI editor renders context and limits, preserves long text, and accepts an in-place revision", async () => {
  const { tool } = setup();
  const controller = new AbortController();
  const original = "x".repeat(180) + " full-answer-tail";
  let selection = 0;
  let editing = 0;
  const result = await tool.execute("call", input(), controller.signal, undefined, {
    mode: "tui",
    hasUI: true,
    ui: {
      select: async (_title, choices) => ++selection === 2 ? choices[1] : finish(choices),
      custom: async (factory) => await new Promise((resolve) => {
        const component = factory(
          { requestRender() {}, terminal: { columns: 80, rows: 30 } },
          undefined, { matches: () => false }, resolve,
        );
        component.focused = true;
        const displayed = stripTerminalSequences(component.render(80).join("\n"));
        assert.match(displayed, /Which scope\?/);
        assert.match(displayed, /2,000 UTF-8 bytes/);
        if (++editing === 1) component.handleInput(`\x1b[200~${original}\x1b[201~`);
        else {
          assert.match(displayed, /full-answer-tail/);
          component.handleInput("\x05");
          component.handleInput("!");
        }
        component.handleInput("\r");
      }),
    },
  });
  assert.equal(editing, 2);
  assert.equal(result.details.answers[0].answer, `${original}!`);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("aborting a native TUI editor closes it and drops earlier selections", async () => {
  const { tool } = setup();
  const controller = new AbortController();
  let selection = 0;
  let closed = 0;
  const result = await tool.execute("call", input({ multiSelect: true }), controller.signal, undefined, {
    mode: "tui",
    hasUI: true,
    ui: {
      select: async (_title, choices) => ++selection === 1 ? choices[0] : other(choices),
      custom: async (factory) => await new Promise((resolve) => {
        factory(
          { requestRender() {}, terminal: { columns: 80, rows: 24 } },
          undefined, { matches: () => false }, (value) => { closed++; resolve(value); },
        );
        controller.abort();
      }),
    },
  });
  assert.equal(closed, 1);
  assert.equal(result.details.cancelled, true);
  assert.deepEqual(result.details.answers, []);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

for (const lateOutcome of ["resolve", "reject"]) {
  test(`RPC editor abort discards a late ${lateOutcome} and clears its abort listener`, async () => {
    const { tool } = setup();
    const controller = new AbortController();
    let settle;
    let selection = 0;
    const result = await tool.execute("call", input({ multiSelect: true }), controller.signal, undefined, {
      mode: "rpc",
      hasUI: true,
      ui: {
        select: async (_title, choices) => ++selection === 1 ? choices[0] : other(choices),
        editor: () => new Promise((resolve, reject) => {
          settle = lateOutcome === "resolve" ? resolve : reject;
          queueMicrotask(() => controller.abort());
        }),
      },
    });
    assert.equal(result.details.cancelled, true);
    assert.deepEqual(result.details.answers, []);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    settle(lateOutcome === "resolve" ? "stale answer" : new Error("late client failure"));
    await Promise.resolve();
    assert.deepEqual(result.details.answers, []);
  });
}

test("cancelling correction of an oversized draft returns no answer", async () => {
  const { tool } = setup();
  let editing = 0;
  const result = await tool.execute("call", input(), undefined, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: {
      select: async (_title, choices) => finish(choices),
      editor: async () => ++editing === 1 ? "x".repeat(ASK_LIMITS.customAnswerBytes + 1) : undefined,
    },
  });
  assert.equal(editing, 2);
  assert.equal(result.details.cancelled, true);
  assert.deepEqual(result.details.answers, []);
});
