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
  bg: (_color, text) => text,
  bold: (text) => text,
};

const defaultKeys = {
  "tui.select.confirm": ["enter"],
  "tui.select.cancel": ["escape"],
  "tui.select.up": ["up"],
  "tui.select.down": ["down"],
  "tui.input.tab": ["tab"],
};

const keybindings = {
  matches(data, action) {
    return (action === "tui.select.confirm" && data === "\r") ||
      (action === "tui.select.cancel" && data === "\x1b") ||
      (action === "tui.select.up" && data === "\x1b[A") ||
      (action === "tui.select.down" && data === "\x1b[B") ||
      (action === "tui.input.tab" && data === "\t");
  },
  getKeys(action) { return defaultKeys[action] ?? []; },
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
  assert.match(rendered, /< □ Targets >/);
  assert.match(rendered, /> 1\. Web\n {4}Browser application/);
  assert.match(rendered, /3\. Type something\./);
  const special = rendered.match(/[^\x00-\x7f]/gu) ?? [];
  assert.ok(special.every((glyph) => "□■☒⎿├─│└〉".includes(glyph)), special.join(""));

  component.handleInput("\r");
  assert.match(component.render(80).join("\n"), /< ■ Submit >/);
  assert.match(component.render(80).join("\n"), /Ready to submit/);
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

test("custom editor submits or cancels without leaking drafts", () => {
  const tui = { terminal: { rows: 30, columns: 80 }, requestRender() {} };
  let submitted;
  const component = createAskComponent(tui, theme, keybindings, questions(), (value) => { submitted = value; });
  component.focused = true;
  component.handleInput("\x1b[B");
  component.handleInput("\x1b[B");
  component.handleInput("\r");
  component.handleInput("custom answer");
  component.handleInput("\r");
  assert.match(component.render(80).join("\n"), /custom answer/);
  component.handleInput("\r");
  assert.equal(submitted.cancelled, false);
  assert.equal(submitted.answers[0].answer, "custom answer");

  let cancelled;
  const abandoned = createAskComponent(tui, theme, keybindings, questions(), (value) => { cancelled = value; });
  abandoned.focused = true;
  abandoned.handleInput("\x1b[B");
  abandoned.handleInput("\x1b[B");
  abandoned.handleInput("\r");
  abandoned.handleInput("draft");
  abandoned.handleInput("\x1b");
  assert.doesNotMatch(abandoned.render(80).join("\n"), /draft/);
  abandoned.handleInput("\x1b");
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(cancelled.answers, []);
});

test("active tabs and help stay explicit without color or default keybindings", () => {
  const tui = { terminal: { rows: 30, columns: 80 }, requestRender() {} };
  const rebound = {
    matches: keybindings.matches,
    getKeys(action) {
      return {
        "tui.select.confirm": ["ctrl+g"],
        "tui.select.cancel": ["ctrl+x"],
        "tui.select.up": ["k"],
        "tui.select.down": ["j"],
        "tui.input.tab": ["ctrl+n"],
      }[action] ?? [];
    },
  };
  const rendered = createAskComponent(tui, theme, rebound, questions(), () => {}).render(80).join("\n");
  assert.match(rendered, /< □ Targets >/);
  assert.match(rendered, /> 1\. Web/);
  assert.match(rendered, /ctrl\+g to select/);
  assert.match(rendered, /ctrl\+n\/k\/j to navigate/);
  assert.match(rendered, /ctrl\+x to cancel/);
});

test("enhanced keyboard sequences navigate and toggle choices", () => {
  const tui = { terminal: { rows: 30, columns: 80 }, requestRender() {} };
  let result;
  const component = createAskComponent(tui, theme, keybindings, questions(true), (value) => { result = value; });

  component.handleInput("\x1b[1;1C");
  assert.match(component.render(80).join("\n"), /Ready to submit/);
  component.handleInput("\x1b[1;1D");
  component.handleInput("\x1b[32u");
  component.handleInput("\x1b");
  assert.equal(result.answers[0].answer, "Web");

  const shifted = createAskComponent(tui, theme, keybindings, questions(), () => {});
  shifted.handleInput("\x1b[9;2u");
  assert.match(shifted.render(80).join("\n"), /Ready to submit/);
});

test("questionnaire rendering stays within narrow and short terminals", () => {
  for (let rows = 4; rows <= 14; rows++) {
    const tui = { terminal: { rows, columns: 32 }, requestRender() {} };
    const component = createAskComponent(tui, theme, keybindings, questions(), () => {});
    const lines = component.render(32);
    assert.ok(lines.length <= Math.max(1, rows - 2), `height ${rows}: ${lines.length}`);
    assert.ok(lines.every((line) => visibleWidth(line) <= 32), `width overflow at ${rows}`);
    if (rows === 8) assert.match(lines.join("\n"), /> 1\./);
  }

  const tui = { terminal: { rows: 10, columns: 32 }, requestRender() {} };
  const editing = createAskComponent(tui, theme, keybindings, questions(), () => {});
  editing.focused = true;
  editing.handleInput("\x1b[B");
  editing.handleInput("\x1b[B");
  editing.handleInput("\r");
  assert.ok(editing.render(32).some((line) => line.includes(CURSOR_MARKER)));
});
