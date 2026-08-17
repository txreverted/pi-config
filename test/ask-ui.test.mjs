import test from "node:test";
import assert from "node:assert/strict";
import { askTimeoutMs, normalizeQuestions } from "../extensions/ask-core.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
import { AskState, createAskComponent } from "../extensions/ask-ui.ts";

test("new question fields are normalized with grapheme limits", () => {
  const [question] = normalizeQuestions([{
    id: "targets",
    header: "e\u0301".repeat(12),
    question: "Which targets?",
    multiSelect: true,
    options: [{ label: "Web", description: "Browser target", preview: "**Browser**\n\u001b]0;unsafe\u0007Details" }, { label: "CLI" }],
  }]);

  assert.equal(question.header, "e\u0301".repeat(12));
  assert.equal(question.multiSelect, true);
  assert.equal(question.options[0].description, "Browser target");
  assert.equal(question.options[0].preview, "**Browser**\nDetails");
  assert.throws(() => normalizeQuestions([{
    id: "long",
    header: "😀".repeat(13),
    question: "Too long?",
  }]), /at most 12/);
  assert.throws(() => normalizeQuestions([{
    id: "free",
    question: "Free?",
    multiSelect: true,
  }]), /without options/);
});

test("ask timeout accepts only the documented values", () => {
  assert.equal(askTimeoutMs("off"), undefined);
  assert.equal(askTimeoutMs("60s"), 60_000);
  assert.equal(askTimeoutMs("5m"), 300_000);
  assert.equal(askTimeoutMs("10m"), 600_000);
  assert.throws(() => askTimeoutMs("1m"), /must be off, 60s, 5m, or 10m/);
});

test("questionnaire rendering obeys available rows on short terminals", () => {
  const questions = normalizeQuestions([{
    id: "short",
    header: "Short",
    question: "Choose safely?",
    options: Array.from({ length: 5 }, (_, index) => ({ label: `Option ${index}`, description: "A bounded description" })),
  }]);
  const theme = {
    fg: (_color, text) => text,
    bold: (text) => text,
    italic: (text) => text,
    strikethrough: (text) => text,
  };
  const keybindings = { matches: () => false };
  for (let rows = 4; rows <= 12; rows++) {
    const tui = { terminal: { rows, columns: 40 }, requestRender() {} };
    const component = createAskComponent(tui, theme, keybindings, questions, "Context that wraps across rows", () => {});
    const lines = component.render(40);
    assert.ok(lines.length <= rows - 2, `height ${rows}: ${lines.length} rows`);
    assert.ok(lines.every((line) => visibleWidth(line) <= 40), `height ${rows}: width overflow`);
  }
});

test("question state supports multi-select, custom answers, and backtracking", () => {
  const questions = normalizeQuestions([
    {
      id: "targets",
      header: "Targets",
      question: "Which targets?",
      multiSelect: true,
      options: [{ label: "Web" }, { label: "CLI" }],
    },
    { id: "notes", question: "Specific requirement?" },
  ]);
  const state = new AskState(questions);

  state.choose(0);
  state.choose(1);
  state.write("Also mobile");
  state.movePage(1);
  state.write("Keep compatibility");
  state.movePage(1);

  assert.equal(state.review, true);
  assert.equal(state.allAnswered, true);
  assert.deepEqual(state.answers(), [
    {
      id: "targets",
      question: "Which targets?",
      answer: "Web, CLI, Also mobile",
      kind: "option",
      optionIndexes: [1, 2],
    },
    {
      id: "notes",
      question: "Specific requirement?",
      answer: "Keep compatibility",
      kind: "custom",
    },
  ]);

  state.movePage(-1);
  assert.equal(state.question.id, "notes");
  state.write("Revised");
  assert.equal(state.answers()[1].answer, "Revised");
  state.write("\u001b]52;c;payload\u0007");
  assert.equal(state.isAnswered(state.question), false);
  assert.doesNotMatch(JSON.stringify(state.answers()), /payload|\u001b/);
});
