import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  formatCwd,
  formatElapsed,
  formatTokens,
  wrapStatusLine,
} from "../extensions/ui-core.ts";

test("UI formatters keep status values compact", () => {
  assert.equal(formatCwd(homedir()), "~");
  assert.equal(formatCwd(join(homedir(), "work", "repo")), `~${sep}work${sep}repo`);
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1_250), "1.3k");
  assert.equal(formatTokens(125_000), "125k");
  assert.equal(formatElapsed(999), "0s");
  assert.equal(formatElapsed(65_000), "1m05");
  assert.equal(formatElapsed(3_661_000), "1h01m");
});

test("status lines wrap without exceeding the terminal width", () => {
  const status = "\u001b[1mπ\u001b[22m v0.84.2 〉~/Documents/pi-config(main) 〉gpt-5.6-sol (high) 〉35.7%/272k (auto) 〉$69.417 (sub)";
  for (const width of [1, 20, 40, 80]) {
    const lines = wrapStatusLine(status, width);
    assert.ok(lines.length > 0);
    assert.ok(lines.every((line) => visibleWidth(line) <= width), `width ${width}: ${JSON.stringify(lines)}`);
    if (width < visibleWidth(status)) assert.ok(lines.length > 1, `width ${width}`);
  }
});
