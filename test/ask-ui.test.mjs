import test from "node:test";
import assert from "node:assert/strict";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { normalizeQuestions } from "../extensions/ask-core.ts";
import { AskState, createAskComponent } from "../extensions/ask-ui.ts";

const questions = (multiSelect = false) => normalizeQuestions([{
  header: "Targets",
  question: "Which targets?",
  options: [
    { label: "Web", description: "Browser application" },
    { label: "CLI", description: "Terminal application" },
  ],
  multiSelect,
}]);

const theme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

const keybindings = {
  matches(data, action) {
    return (action === "tui.select.confirm" && data === "\r") ||
      (action === "tui.select.cancel" && data === "\x1b") ||
      (action === "tui.select.up" && data === "\x1b[A") ||
      (action === "tui.select.down" && data === "\x1b[B") ||
      (action === "tui.input.tab" && data === "\t");
  },
};

test("question state supports multi-select, custom answers, and backtracking", () => {
  const state = new AskState(questions(true));
  state.choose(0);
  state.choose(1);
  state.write("Also mobile");
  state.movePage(1);

  assert.equal(state.review, true);
  assert.equal(state.allAnswered, true);
  assert.deepEqual(state.answers(), [{
    question: "Which targets?",
    answer: "Web, CLI, Also mobile",
    optionIndexes: [1, 2],
    custom: true,
  }]);

  state.movePage(-1);
  state.write("Revised");
  assert.equal(state.answers()[0].answer, "Web, CLI, Revised");
  state.write("\u001b]52;c;payload\u0007");
  assert.equal(state.answers()[0].answer, "Web, CLI");
});

test("single-choice flow reviews and submits with approved glyphs", () => {
  const tui = { terminal: { rows: 30, columns: 80 }, requestRender() {} };
  let result;
  const component = createAskComponent(tui, theme, keybindings, questions(), (value) => { result = value; });
  component.focused = true;
  assert.equal(component.focused, true);

  const rendered = component.render(80).join("\n");
  assert.match(rendered, /> ├─ □ Web/);
  assert.match(rendered, /└─ □ Other/);
  const special = rendered.match(/[^\x00-\x7f]/gu) ?? [];
  assert.ok(special.every((glyph) => "□■☒⎿├─│└".includes(glyph)), special.join(""));

  component.handleInput("\r");
  assert.match(component.render(80).join("\n"), /Review answers/);
  component.handleInput("\r");
  assert.deepEqual(result, {
    answers: [{ question: "Which targets?", answer: "Web", optionIndexes: [1], custom: false }],
    cancelled: false,
  });
});

test("multi-select toggles choices and cancellation preserves partial answers", () => {
  const tui = { terminal: { rows: 30, columns: 80 }, requestRender() {} };
  let result;
  const component = createAskComponent(tui, theme, keybindings, questions(true), (value) => { result = value; });
  component.handleInput(" ");
  component.handleInput("\x1b[B");
  component.handleInput(" ");
  component.handleInput("\x1b");

  assert.deepEqual(result, {
    answers: [{ question: "Which targets?", answer: "Web, CLI", optionIndexes: [1, 2], custom: false }],
    cancelled: true,
  });
});

test("enhanced keyboard sequences navigate and toggle choices", () => {
  const tui = { terminal: { rows: 30, columns: 80 }, requestRender() {} };
  let result;
  const component = createAskComponent(tui, theme, keybindings, questions(true), (value) => { result = value; });

  component.handleInput("\x1b[1;1C");
  assert.match(component.render(80).join("\n"), /Review answers/);
  component.handleInput("\x1b[1;1D");
  component.handleInput("\x1b[32u");
  component.handleInput("\x1b");
  assert.equal(result.answers[0].answer, "Web");

  const shifted = createAskComponent(tui, theme, keybindings, questions(), () => {});
  shifted.handleInput("\x1b[9;2u");
  assert.match(shifted.render(80).join("\n"), /Review answers/);
});

test("questionnaire rendering stays within narrow and short terminals", () => {
  for (let rows = 4; rows <= 14; rows++) {
    const tui = { terminal: { rows, columns: 32 }, requestRender() {} };
    const component = createAskComponent(tui, theme, keybindings, questions(), () => {});
    const lines = component.render(32);
    assert.ok(lines.length <= Math.max(1, rows - 2), `height ${rows}: ${lines.length}`);
    assert.ok(lines.every((line) => visibleWidth(line) <= 32), `width overflow at ${rows}`);
    if (rows === 8) assert.match(lines.join("\n"), /> ├─/);
  }

  const tui = { terminal: { rows: 10, columns: 32 }, requestRender() {} };
  const editing = createAskComponent(tui, theme, keybindings, questions(), () => {});
  editing.focused = true;
  editing.handleInput("\x1b[B");
  editing.handleInput("\x1b[B");
  editing.handleInput("\r");
  assert.ok(editing.render(32).some((line) => line.includes(CURSOR_MARKER)));
});
