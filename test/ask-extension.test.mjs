import test from "node:test";
import assert from "node:assert/strict";
import { Value } from "typebox/value";
import { ASK_LIMITS } from "../extensions/ask-core.ts";
import askExtension from "../extensions/ask.ts";

function setup() {
  const tools = new Map();
  const handlers = new Map();
  let active = ["read", "ask_user_question"];
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    on(event, handler) { handlers.set(event, handler); },
    getActiveTools: () => [...active],
    setActiveTools(names) { active = [...names]; },
  };
  askExtension(pi);
  return { tool: tools.get("ask_user_question"), handlers, active: () => active };
}

test("question tool schema uses the shared boundaries", () => {
  const { tool } = setup();
  const valid = {
    context: "c".repeat(ASK_LIMITS.context),
    questions: Array.from({ length: ASK_LIMITS.questions.max }, (_, questionIndex) => ({
      id: `q${questionIndex}${"i".repeat(ASK_LIMITS.id - 2)}`,
      question: "q".repeat(ASK_LIMITS.question),
      options: Array.from({ length: ASK_LIMITS.options.max }, (_, optionIndex) => ({
        label: `${optionIndex}${"l".repeat(ASK_LIMITS.label - 1)}`,
        description: "d".repeat(ASK_LIMITS.description),
      })),
    })),
  };

  assert.equal(Value.Check(tool.parameters, valid), true);
  assert.equal(Value.Check(tool.parameters, { ...valid, context: `${valid.context}x` }), false);
  assert.equal(Value.Check(tool.parameters, {
    questions: [{ id: "graphemes", question: "e\u0301".repeat(ASK_LIMITS.question) }],
  }), true);
  assert.equal(Value.Check(tool.parameters, {
    questions: [{ id: "graphemes", question: "e\u0301".repeat(ASK_LIMITS.question + 1) }],
  }), false);
  assert.equal(Value.Check(tool.parameters, { questions: [...valid.questions, valid.questions[0]] }), false);
  assert.equal(Value.Check(tool.parameters, {
    questions: [{ ...valid.questions[0], options: valid.questions[0].options.slice(0, ASK_LIMITS.options.min - 1) }],
  }), false);
});

test("question tool executes choices and reports cancellation", async () => {
  const { tool } = setup();
  const ctx = {
    hasUI: true,
    ui: {
      select: async (_title, choices) => choices[0],
      editor: async () => "custom",
    },
  };
  const answered = await tool.execute("call", {
    questions: [{ id: "scope", question: "Scope?", options: [{ label: "Small" }, { label: "Large" }] }],
  }, undefined, undefined, ctx);
  assert.match(answered.content[0].text, /Answer: Small/);
  assert.equal(answered.details.cancelled, false);

  ctx.ui.select = async () => undefined;
  const cancelled = await tool.execute("call", {
    questions: [{ id: "scope", question: "Scope?", options: [{ label: "Small" }, { label: "Large" }] }],
  }, undefined, undefined, ctx);
  assert.equal(cancelled.details.cancelled, true);
  assert.deepEqual(cancelled.details.answers, []);
});

test("rendered option labels retain stable identities", async () => {
  const { tool } = setup();
  const result = await tool.execute("call", {
    questions: [{
      id: "choice",
      question: "Choose?",
      options: [{ label: "A (recommended)" }, { label: "A", recommended: true }],
    }],
  }, undefined, undefined, {
    hasUI: true,
    ui: {
      select: async (_title, choices) => choices[1],
      editor: async () => undefined,
    },
  });

  assert.equal(result.details.answers[0].answer, "A");
  assert.equal(result.details.answers[0].optionIndex, 2);
});

test("questionnaire sanitizes titles, choices, and custom answers", async () => {
  const { tool } = setup();
  let shownTitle = "";
  let shownChoices = [];
  const result = await tool.execute("call", {
    context: "Context\u001b]0;title\u0007",
    questions: [{
      id: "choice",
      question: "Choose\u202e?",
      options: [{ label: "Small\u001b[31m" }, { label: "Large" }],
    }],
  }, undefined, undefined, {
    hasUI: true,
    ui: {
      select: async (title, choices) => {
        shownTitle = title;
        shownChoices = choices;
        return choices.at(-1);
      },
      editor: async () => "custom\u001b]52;c;SGFja2Vk\u0007\nanswer",
    },
  });

  assert.equal(shownTitle, "Context\n\n1/1 · Choose?");
  assert.equal(shownChoices[0], "1. Small");
  assert.match(result.content[0].text, /Answer: custom\n    answer/);
  assert.doesNotMatch(result.content[0].text, /[\u001b\u0007\u202e]/);

  await assert.rejects(
    () => tool.execute("call", {
      context: "\u001b]0;gone\u0007",
      questions: [{ id: "scope", question: "Scope?" }],
    }, undefined, undefined, {
      hasUI: true,
      ui: { editor: async () => "answer" },
    }),
    /context cannot be empty after sanitation/,
  );

  const empty = await tool.execute("call", {
    questions: [{ id: "scope", question: "Scope?" }],
  }, undefined, undefined, {
    hasUI: true,
    ui: { editor: async () => "\u001b]52;c;SGFja2Vk\u0007" },
  });
  assert.equal(empty.details.cancelled, true);
  assert.deepEqual(empty.details.answers, []);

  const cancelled = await tool.execute("call", {
    questions: [{ id: "scope", question: "Scope?" }],
  }, undefined, undefined, {
    hasUI: true,
    ui: { editor: async () => undefined },
  });
  assert.equal(cancelled.details.cancelled, true);
});

test("RPC free-form answers obey tool cancellation", async () => {
  const { tool } = setup();
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  let opened = false;
  const cancelledBeforeOpen = await tool.execute("call", {
    questions: [{ id: "scope", question: "Scope?" }],
  }, alreadyAborted.signal, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: { input: async () => { opened = true; } },
  });
  assert.equal(opened, false);
  assert.equal(cancelledBeforeOpen.details.cancelled, true);

  const controller = new AbortController();
  let receivedSignal;
  const pending = tool.execute("call", {
    questions: [{ id: "scope", question: "Scope?" }],
  }, controller.signal, undefined, {
    mode: "rpc",
    hasUI: true,
    ui: {
      input: async (_title, _placeholder, options) => {
        receivedSignal = options.signal;
        return new Promise((resolve) => options.signal.addEventListener("abort", () => resolve(undefined), { once: true }));
      },
    },
  });
  controller.abort();
  const cancelledWhileOpen = await pending;
  assert.equal(receivedSignal.aborted, true);
  assert.equal(cancelledWhileOpen.details.cancelled, true);
});

test("four emoji-heavy custom answers remain under Pi's output cap", async () => {
  const { tool } = setup();
  const result = await tool.execute("call", {
    questions: Array.from({ length: ASK_LIMITS.questions.max }, (_, index) => ({
      id: `q${index}`,
      question: "😀".repeat(ASK_LIMITS.question),
    })),
  }, undefined, undefined, {
    hasUI: true,
    ui: { editor: async () => "😀".repeat(ASK_LIMITS.customAnswerBytes) },
  });

  assert.equal(result.details.cancelled, false);
  assert.equal(result.details.answers.length, ASK_LIMITS.questions.max);
  assert.ok(result.details.answers.every((answer) => Buffer.byteLength(answer.answer, "utf8") <= ASK_LIMITS.customAnswerBytes));
  assert.match(result.content[0].text, /Custom answer truncated/);
  assert.doesNotMatch(result.content[0].text, /Clarification answers truncated/);
  assert.ok(Buffer.byteLength(result.content[0].text, "utf8") <= ASK_LIMITS.outputBytes);
});

test("question tool rejects non-UI execution and removes itself from non-UI sessions", async () => {
  const { tool, handlers, active } = setup();
  await assert.rejects(
    () => tool.execute("call", { questions: [{ id: "scope", question: "Scope?" }] }, undefined, undefined, { hasUI: false }),
    /requires an interactive/,
  );
  handlers.get("session_start")({}, { hasUI: false });
  assert.deepEqual(active(), ["read"]);
});
