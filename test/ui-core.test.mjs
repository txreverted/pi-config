import test from "node:test";
import assert from "node:assert/strict";
import {
  applyUiGutter,
  budgetUiBlocks,
  collapseBlankLines,
  composeUiBlocks,
  isVisuallyBlank,
  normalizeDisplayText,
} from "../extensions/ui-core.ts";

test("display helpers enforce one blank row and one outer gutter", () => {
  const unsafe = "one\n\n \n\u001b[31m\u001b[0m\n\ntwo";
  assert.equal(normalizeDisplayText(unsafe), "one\n\ntwo");
  assert.equal(isVisuallyBlank("\u001b[31m \u001b[0m"), true);
  assert.deepEqual(collapseBlankLines(["a", "", " ", "b"]), ["a", "", "b"]);
  assert.deepEqual(applyUiGutter(["alpha", "", "  nested"], 20), [" alpha", " ", "   nested"]);
  assert.deepEqual(composeUiBlocks([["one", "", ""], ["two"]], 20, true), [" one", " ", " two", " "]);
});

test("panel budgets retain headings and use ASCII truncation notices", () => {
  const blocks = budgetUiBlocks([
    ["Todos", "one", "two", "three"],
    ["goal: active"],
  ], 4, true);
  assert.match(blocks[0][0], /^Todos/);
  assert.equal(blocks[1][0], "goal: active");
  assert.match(blocks.flat().join("\n"), /\.\.\.|more/);
});
