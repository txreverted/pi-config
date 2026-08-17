import test from "node:test";
import assert from "node:assert/strict";
import {
  ASK_LIMITS,
  CUSTOM_CHOICE,
  boundCustomAnswer,
  formatAnswers,
  normalizeContext,
  normalizeQuestions,
  optionDisplay,
} from "../extensions/ask-core.ts";

test("questions are normalized and options are rendered with trade-offs", () => {
  const questions = normalizeQuestions([
    {
      id: " scope ",
      question: " Which scope? ",
      options: [
        { label: " Minimal ", description: " Smallest useful change ", recommended: true },
        { label: " Complete", description: "More features" },
      ],
    },
    { id: "notes", question: "Anything else?" },
  ]);

  assert.deepEqual(questions, [
    {
      id: "scope",
      question: "Which scope?",
      options: [
        { label: "Minimal", description: "Smallest useful change", recommended: true },
        { label: "Complete", description: "More features" },
      ],
    },
    { id: "notes", question: "Anything else?" },
  ]);
  assert.equal(optionDisplay(questions[0].options[0]), "Minimal (recommended) — Smallest useful change");
  assert.equal(CUSTOM_CHOICE, "Write a different answer…");
});

test("invalid questionnaires are rejected", () => {
  assert.throws(() => normalizeQuestions([]), /1 and 4/);
  assert.throws(
    () => normalizeQuestions([
      { id: "same", question: "First?" },
      { id: "same", question: "Second?" },
    ]),
    /unique/,
  );
  assert.throws(
    () => normalizeQuestions([
      {
        id: "scope",
        question: "Scope?",
        options: [{ label: "Only one" }],
      },
    ]),
    /2-5 options/,
  );
  assert.throws(
    () => normalizeQuestions([
      {
        id: "scope",
        question: "Scope?",
        options: [{ label: "Other" }, { label: "Complete" }],
      },
    ]),
    /reserved/,
  );
  assert.throws(
    () => normalizeQuestions([
      {
        id: "scope",
        question: "Scope?",
        options: [
          { label: "Minimal", recommended: true },
          { label: "Complete", recommended: true },
        ],
      },
    ]),
    /at most one/,
  );
  assert.throws(
    () => normalizeQuestions([{ id: "bad id", question: "Unsafe?" }]),
    /letters, digits/,
  );
  assert.throws(
    () => normalizeQuestions([{
      id: "empty",
      question: "Unsafe?",
      options: [{ label: "One", description: "\u001b]0;gone\u0007" }, { label: "Two" }],
    }]),
    /empty description after sanitation/,
  );
});

test("shared questionnaire limits are enforced after sanitation", () => {
  assert.equal(normalizeContext("x".repeat(ASK_LIMITS.context)), "x".repeat(ASK_LIMITS.context));
  assert.throws(() => normalizeContext("x".repeat(ASK_LIMITS.context + 1)), /at most 500/);

  assert.doesNotThrow(() => normalizeQuestions([{
    id: "i".repeat(ASK_LIMITS.id),
    question: "q".repeat(ASK_LIMITS.question),
    options: Array.from({ length: ASK_LIMITS.options.max }, (_, index) => ({
      label: `${index}${"l".repeat(ASK_LIMITS.label - 1)}`,
      description: "d".repeat(ASK_LIMITS.description),
    })),
  }]));
  assert.throws(
    () => normalizeQuestions([{ id: "id", question: "q".repeat(ASK_LIMITS.question + 1) }]),
    /at most 500/,
  );
  assert.doesNotThrow(() => normalizeQuestions([{
    id: "graphemes",
    question: "e\u0301".repeat(ASK_LIMITS.question),
  }]));
  assert.throws(() => normalizeQuestions([{
    id: "graphemes",
    question: "e\u0301".repeat(ASK_LIMITS.question + 1),
  }]), /at most 500/);
  assert.throws(
    () => normalizeQuestions([{
      id: "id",
      question: "Question?",
      options: [{ label: "l".repeat(ASK_LIMITS.label + 1) }, { label: "Two" }],
    }]),
    /at most 80/,
  );
  assert.throws(
    () => normalizeQuestions(Array.from({ length: ASK_LIMITS.questions.max + 1 }, (_, index) => ({
      id: `q${index}`,
      question: "Question?",
    }))),
    /between 1 and 4/,
  );
});

test("question text is safe before it reaches the terminal", () => {
  const [question] = normalizeQuestions([{
    id: "safe",
    question: "Choose\u001b]52;c;SGFja2Vk\u0007 now\u202e?",
    options: [
      { label: "One\u001b[31m" },
      { label: "Two", description: "line\nwrapped" },
    ],
  }]);
  assert.equal(question.question, "Choose now?");
  assert.equal(question.options[0].label, "One");
  assert.equal(question.options[1].description, "line wrapped");
});

test("emoji-heavy custom answers are byte bounded with visible truncation", () => {
  const answers = Array.from({ length: ASK_LIMITS.questions.max }, (_, index) => ({
    id: `q${index}`,
    question: "😀".repeat(ASK_LIMITS.question),
    answer: boundCustomAnswer("😀".repeat(ASK_LIMITS.customAnswerBytes)),
    kind: "custom",
  }));

  assert.ok(answers.every((answer) => Buffer.byteLength(answer.answer, "utf8") <= ASK_LIMITS.customAnswerBytes));
  assert.ok(answers.every((answer) => answer.answer.includes("[Custom answer truncated")));
  assert.ok(Buffer.byteLength(formatAnswers(answers), "utf8") <= ASK_LIMITS.outputBytes);

  const forced = formatAnswers([{ id: "large", question: "Large?", answer: "😀".repeat(20_000), kind: "custom" }]);
  assert.ok(Buffer.byteLength(forced, "utf8") <= ASK_LIMITS.outputBytes);
  assert.match(forced, /Clarification answers truncated/);

  const manyLines = formatAnswers([{ id: "lines", question: "Lines?", answer: "x\n".repeat(10_000), kind: "custom" }]);
  assert.ok(manyLines.split("\n").length <= 2_000);
  assert.match(manyLines, /Clarification answers truncated/);
});

test("answers are formatted clearly, including multiline custom text", () => {
  const formatted = formatAnswers([
    {
      id: "scope",
      question: "Which scope?",
      answer: "Minimal",
      kind: "option",
      optionIndex: 1,
    },
    {
      id: "notes",
      question: "Anything else?",
      answer: "Keep it small.\nAdd tests.",
      kind: "custom",
    },
  ]);

  assert.equal(
    formatted,
    "User answered the clarification questions:\n" +
      "- scope: Which scope?\n" +
      "  Answer: Minimal\n" +
      "- notes: Anything else?\n" +
      "  Answer: Keep it small.\n" +
      "    Add tests.",
  );
});
