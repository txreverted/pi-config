import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensions = ["ui.ts", "tools.ts", "web.ts", "ask.ts", "orchestration.ts", "ponytail.ts", "subagent-tools.ts"];
const args = [
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-themes",
];
for (const extension of extensions) args.push("--extension", resolve(root, "extensions", extension));
for (const skill of ["ponytail", "ponytail-review", "ponytail-audit", "ponytail-debt", "ponytail-gain", "ponytail-help"]) {
  args.push("--skill", resolve(root, "skills", skill, "SKILL.md"));
}
args.push("--theme", resolve(root, "themes", "neutral.json"));
args.push("--use-theme", "neutral");
args.push("--list-models", "__pi_config_smoke_no_such_model__");

const result = spawnSync("pi", args, {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, PI_OFFLINE: "1" },
  timeout: 30_000,
});

if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout, /No models (?:matching|available)/);
assert.doesNotMatch(result.stderr, /error|failed|exception/i);
const packageResult = spawnSync("pi", [
  "-e", root,
  "--no-skills",
  "--list-models", "__pi_config_package_smoke_no_such_model__",
], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, PI_OFFLINE: "1" },
  timeout: 30_000,
});
if (packageResult.error) throw packageResult.error;
assert.equal(packageResult.status, 0, packageResult.stderr || packageResult.stdout);
assert.match(packageResult.stdout, /No models (?:matching|available)/);
assert.doesNotMatch(packageResult.stderr, /error|failed|exception/i);

console.log(`Loaded ${extensions.length} stable modules directly and loaded the complete package manifest through Pi.`);
