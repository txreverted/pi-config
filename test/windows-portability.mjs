import { spawnSync } from "node:child_process";

const patterns = [
  "worker worktrees reject dirty parent checkouts",
  "read-only agent tools remain inside their delegated workspace",
  "writable policy runs tools without approval",
  "bounded process keeps small output in memory",
  "bounded process enforces timeouts and cancellation",
];
const files = [
  "test/subagents-worktree.test.mjs",
  "test/tools-core.test.mjs",
];
if (spawnSync("jq", ["--version"], { encoding: "utf8" }).status === 0) {
  patterns.push("jq executes shell-free input", "jq excludes parent secrets");
  files.push("test/tools-extension.test.mjs");
}

const result = spawnSync(process.execPath, [
  "--experimental-strip-types",
  "--test",
  "--test-name-pattern",
  patterns.join("|"),
  ...files,
], { encoding: "utf8" });

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);
const passed = Number(result.stdout.match(/^# pass (\d+)\r?$/m)?.[1]);
if (passed !== patterns.length) {
  throw new Error(`Windows portability suite expected ${patterns.length} matching tests, but ${passed} passed`);
}
