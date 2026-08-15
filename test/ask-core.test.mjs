import test from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_CHOICE,
  formatAnswers,
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
