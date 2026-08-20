import test from "node:test";
import assert from "node:assert/strict";
import { escapeUnsafeDisplayText, normalizeDisplayText, safeDisplayLine, safeDisplayText } from "../extensions/text-safety.ts";

test("multiline display text removes terminal and directional controls", () => {
  const value =
    "safe\u001b[31m red\u001b[0m\n" +
    "clip\u001b]52;c;SGFja2Vk\u0007end\n" +
    "title\u001b]0;changed\u001b\\end\r\n" +
    "c1\u009b31mred\u009d52;c;C1CLIP\u009cend\n" +
    "dcs\u001bPsecret\u001b\\end\n" +
    "left\u202eright\u2066end\u2069\tkept\u0085\u200bzero\u2060word\ufeffend";
  const sanitized = safeDisplayText(value);

  assert.equal(sanitized, "safe red\nclipend\ntitleend\nc1redend\ndcsend\nleftrightend\tkeptzerowordend");
  assert.doesNotMatch(sanitized, /[\u001b\u0007\u009b\u200b\u202e\u2060\u2066\u2069\ufeff]/);
});

test("unsafe display characters can be rendered visibly without active terminal controls", () => {
  const escaped = escapeUnsafeDisplayText("line\r\n\u001b[31mred\u001b[0m\u202eend\tkept");
  assert.equal(escaped, "line\\x0d\n\\x1b[31mred\\x1b[0m\\u202eend\tkept");
  assert.doesNotMatch(escaped, /[\u001b\u202e]/);
  assert.equal(escapeUnsafeDisplayText("\u001b\\x1b"), "\\x1b\\\\x1b");
});

test("display normalization collapses repeated blank rows", () => {
  assert.equal(normalizeDisplayText("one\n\n \n\u001b[31m\u001b[0m\n\ntwo"), "one\n\ntwo");
});

test("single-line display text collapses whitespace and truncates by character", () => {
  assert.equal(safeDisplayLine("  one\n\ttwo\r three  "), "one two three");
  assert.equal(safeDisplayLine("a😀bc", 4), "a😀bc");
  assert.equal(safeDisplayLine("a😀bcd", 4), "a...");
  assert.throws(() => safeDisplayLine("x", 0), /positive integer/);
});
