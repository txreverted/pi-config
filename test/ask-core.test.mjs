import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import {
  ASK_LIMITS,
  CUSTOM_ANSWER_LIMIT_TEXT,
  boundCustomAnswer,
  formatAnswers,
  normalizeQuestions,
} from "../extensions/ask-core.ts";

const question = (overrides = {}) => ({
  header: "Scope",
  question: "Which scope?",
  options: [
    { label: "Small", description: "Smallest useful change" },
    { label: "Complete", description: "All requested behavior" },
  ],
  multiSelect: false,
  ...overrides,
});

test("questions are normalized and terminal controls are removed", () => {
  assert.deepEqual(normalizeQuestions([question({
    header: " Scope ",
    question: " Which\u001b]0;unsafe\u0007 scope\u202e? ",
    options: [
      { label: " Small\u001b[31m ", description: " Smallest\nchange " },
      { label: "Complete", description: "All behavior" },
    ],
  })]), [question({
    question: "Which scope?",
    options: [
      { label: "Small", description: "Smallest change" },
      { label: "Complete", description: "All behavior" },
    ],
  })]);
});

test("Claude-like question boundaries are enforced", () => {
  assert.throws(() => normalizeQuestions([]), /between 1 and 4/);
  assert.throws(() => normalizeQuestions(Array.from({ length: 5 }, () => question())), /between 1 and 4/);
  assert.throws(() => normalizeQuestions([question({ header: "x".repeat(ASK_LIMITS.header + 1) })]), /header/);
  assert.throws(() => normalizeQuestions([question({ header: `a${"\u0301".repeat(10_000)}` })]), /header/);
  assert.throws(() => normalizeQuestions([question({ question: "x".repeat(ASK_LIMITS.question + 1) })]), /at most 500/);
  assert.throws(() => normalizeQuestions([question({ options: [{ label: "One", description: "Only" }] })]), /2-4 options/);
  assert.throws(() => normalizeQuestions([question({ options: [
    { label: "Other", description: "Reserved" },
    { label: "Two", description: "Second" },
  ] })]), /reserved/);
  assert.throws(() => normalizeQuestions([question({ multiSelect: undefined })]), /requires multiSelect/);
  assert.throws(() => normalizeQuestions([question(), question()]), /Questions must be unique/);
  assert.doesNotThrow(() => normalizeQuestions([question({ header: "e\u0301".repeat(ASK_LIMITS.header) })]));
});

test("custom answers are sanitized and bounded by lines and UTF-8 bytes", () => {
  assert.equal(boundCustomAnswer(" answer\u001b]52;c;payload\u0007\r\nnext "), "answer\nnext");
  assert.equal(boundCustomAnswer("\u001b]0;gone\u0007"), undefined);
  assert.equal(boundCustomAnswer({ answer: "not a string" }), undefined);

  const exactBytes = "x".repeat(ASK_LIMITS.customAnswerBytes);
  const exactUnicodeBytes = "😀".repeat(ASK_LIMITS.customAnswerBytes / 4);
  const exactLines = Array.from({ length: ASK_LIMITS.customAnswerLines }, () => "x").join("\n");
  assert.equal(boundCustomAnswer(exactBytes), exactBytes);
  assert.equal(boundCustomAnswer(exactUnicodeBytes), exactUnicodeBytes);
  assert.equal(boundCustomAnswer(exactLines), exactLines);

  const notice = `[Answer truncated to the ask tool limit: ${CUSTOM_ANSWER_LIMIT_TEXT}.]`;
  for (const bounded of [
    boundCustomAnswer("😀".repeat(ASK_LIMITS.customAnswerBytes)),
    boundCustomAnswer(Array.from({ length: ASK_LIMITS.customAnswerLines + 1 }, () => "x").join("\n")),
  ]) {
    assert.ok(Buffer.byteLength(bounded, "utf8") <= ASK_LIMITS.customAnswerBytes);
    assert.ok(bounded.split("\n").length <= ASK_LIMITS.customAnswerLines);
    assert.equal(bounded.endsWith(notice), true);
  }
});

test("answers are formatted clearly with multiline indentation", () => {
  assert.equal(formatAnswers([
    { question: "Which scope?", answer: "Small", optionIndexes: [1], custom: false },
    { question: "Anything else?", answer: "Keep it small.\nAdd tests.", optionIndexes: [], custom: true },
  ]), "User answered the clarification questions:\n" +
    "- Which scope?\n" +
    "  Answer: Small\n" +
    "- Anything else?\n" +
    "  Answer: Keep it small.\n" +
    "    Add tests.");
});

test("aggregate answer formatting stays within Pi output limits", () => {
  const output = formatAnswers([{
    question: "Large answer?",
    answer: Array.from({ length: DEFAULT_MAX_LINES + 100 }, () => "x".repeat(40)).join("\n"),
    optionIndexes: [],
    custom: true,
  }]);

  assert.match(output, /\[Clarification answers truncated to stay within Pi's tool output limits\.\]/);
  assert.ok(Buffer.byteLength(output, "utf8") <= DEFAULT_MAX_BYTES);
  assert.ok(output.split("\n").length <= DEFAULT_MAX_LINES);
});
