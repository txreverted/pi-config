import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const manifestExtensions = packageJson.pi.extensions.map((path) => resolve(root, path));
const internalExtensions = [resolve(root, "extensions/subagent-tools.ts")];
const extensions = [...manifestExtensions, ...internalExtensions];
assert.equal(new Set(extensions).size, extensions.length, "Smoke extension paths must be unique");
assert.ok(manifestExtensions.every((path) => extensions.includes(path)), "Every manifest extension must load directly");
const args = [
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-themes",
];
for (const extension of extensions) args.push("--extension", extension);
for (const skill of ["ponytail", "ponytail-review", "ponytail-audit", "ponytail-debt", "ponytail-help"]) {
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

console.log(`Loaded ${manifestExtensions.length} manifest extensions and ${internalExtensions.length} internal module directly, then loaded the complete package manifest through Pi.`);
