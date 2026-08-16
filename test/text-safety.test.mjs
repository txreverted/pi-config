import test from "node:test";
import assert from "node:assert/strict";
import { safeDisplayLine, safeDisplayText } from "../extensions/text-safety.ts";

test("multiline display text removes terminal and directional controls", () => {
  const value =
    "safe\u001b[31m red\u001b[0m\n" +
    "clip\u001b]52;c;SGFja2Vk\u0007end\n" +
    "title\u001b]0;changed\u001b\\end\r\n" +
    "c1\u009b31mred\u009d52;c;C1CLIP\u009cend\n" +
    "dcs\u001bPsecret\u001b\\end\n" +
    "left\u202eright\u2066end\u2069\tkept\u0085";
  const sanitized = safeDisplayText(value);

  assert.equal(sanitized, "safe red\nclipend\ntitleend\nc1redend\ndcsend\nleftrightend\tkept");
  assert.doesNotMatch(sanitized, /[\u001b\u0007\u009b\u202e\u2066\u2069]/);
});

test("single-line display text collapses whitespace and truncates by character", () => {
  assert.equal(safeDisplayLine("  one\n\ttwo\r three  "), "one two three");
  assert.equal(safeDisplayLine("a😀bc", 4), "a😀bc");
  assert.equal(safeDisplayLine("a😀bcd", 4), "a😀b…");
  assert.throws(() => safeDisplayLine("x", 0), /positive integer/);
});
