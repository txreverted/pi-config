import { spawnSync } from "node:child_process";

const pattern = [
  "worker worktrees reject dirty parent checkouts",
  "read-only agent tools remain inside their delegated workspace",
  "writable policy runs tools without approval",
].join("|");

const result = spawnSync(process.execPath, [
  "--experimental-strip-types",
  "--test",
  "--test-name-pattern",
  pattern,
  "test/subagents-worktree.test.mjs",
], { encoding: "utf8" });

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);
const passed = Number(result.stdout.match(/^# pass (\d+)\r?$/m)?.[1]);
if (passed !== 3) throw new Error(`Windows portability suite expected 3 matching tests, but ${passed} passed`);
