import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import {
  formatCwd,
  formatElapsed,
  formatTokens,
  pickStatusCandidate,
} from "../extensions/ui-core.ts";

test("UI formatters keep status values compact", () => {
  assert.equal(formatCwd(homedir()), "~");
  assert.equal(formatCwd(join(homedir(), "work", "repo")), `~${sep}work${sep}repo`);
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1_250), "1.3k");
  assert.equal(formatTokens(125_000), "125k");
  assert.equal(formatElapsed(999), "0s");
  assert.equal(formatElapsed(65_000), "1m05s");
  assert.equal(formatElapsed(3_661_000), "1h01m");
});

test("status candidate selection removes optional detail before truncation", () => {
  const candidates = ["full status line", "medium", "tiny"];
  assert.equal(pickStatusCandidate(candidates, 20, (value) => value.length), "full status line");
  assert.equal(pickStatusCandidate(candidates, 8, (value) => value.length), "medium");
  assert.equal(pickStatusCandidate(candidates, 2, (value) => value.length), "tiny");
});
