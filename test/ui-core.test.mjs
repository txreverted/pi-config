import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
  applyUiGutter,
  collapseBlankLines,
  composeUiBlocks,
  formatCwd,
  formatElapsed,
  formatTokens,
  isVisuallyBlank,
  normalizeDisplayText,
  utilityBarSegments,
  wrapUtilityBar,
} from "../extensions/ui-core.ts";

const values = {
  version: "0.84.2",
  path: "~/Documents/pi-config",
  branch: "branch",
  model: "gpt-5.6-sol",
  thinking: "xhigh",
  contextPercent: 0,
  contextWindow: 272_000,
  cost: 0,
  auth: "sub",
  elapsedMs: 90_000,
};

test("UI formatters keep utility values compact", () => {
  assert.equal(formatCwd(homedir()), "~");
  assert.equal(formatCwd(join(homedir(), "work", "repo")), `~${sep}work${sep}repo`);
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1_250), "1.3k");
  assert.equal(formatTokens(125_000), "125k");
  assert.equal(formatElapsed(999), "0s");
  assert.equal(formatElapsed(65_000), "1m05");
  assert.equal(formatElapsed(3_661_000), "1h01m");
});

test("display helpers enforce one blank row and one outer gutter", () => {
  const unsafe = "one\n\n \n\u001b[31m\u001b[0m\n\ntwo";
  assert.equal(normalizeDisplayText(unsafe), "one\n\ntwo");
  assert.equal(isVisuallyBlank("\u001b[31m \u001b[0m"), true);
  assert.deepEqual(collapseBlankLines(["a", "", " ", "b"]), ["a", "", "b"]);
  assert.deepEqual(applyUiGutter(["alpha", "", "  nested"], 20), [" alpha", " ", "   nested"]);
  assert.deepEqual(composeUiBlocks([["one", "", ""], ["two"]], 20, true), [" one", " ", " two", " "]);
});

test("utility fields wrap at separators and every line fits from 20 to 200 columns", () => {
  const { head, fields } = utilityBarSegments(values);
  for (let width = 20; width <= 200; width++) {
    const lines = wrapUtilityBar(head, fields, width);
    assert.ok(lines.length > 0);
    assert.ok(lines.every((line) => line.startsWith(" ")), `width ${width}: ${JSON.stringify(lines)}`);
    assert.ok(lines.every((line) => visibleWidth(line) <= width), `width ${width}: ${JSON.stringify(lines)}`);
    assert.equal(lines.some((line) => isVisuallyBlank(line)), false);
    assert.ok(lines.slice(1).every((line) => stripTerminalSequences(line).startsWith(" 〉")));
  }
});
