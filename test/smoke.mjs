import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const extensions = packageJson.pi.extensions.map((path) => resolve(root, path));
const promptNames = ["r-docs", "r-impl", "r-git"];
const piCommand = process.platform === "win32" ? "pi.cmd" : "pi";
assert.equal(new Set(extensions).size, extensions.length, "Smoke extension paths must be unique");

function runPi(args, name) {
  const state = mkdtempSync(join(tmpdir(), `pi-config-${name}-`));
  try {
    return spawnSync(piCommand, args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: join(state, "agent"),
        PI_CODING_AGENT_SESSION_DIR: join(state, "sessions"),
        PI_OFFLINE: "1",
      },
      timeout: 30_000,
      shell: process.platform === "win32",
    });
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
}

const args = ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"];
for (const extension of extensions) args.push("--extension", extension);
for (const prompt of promptNames) args.push("--prompt-template", resolve(root, "prompts", `${prompt}.md`));
args.push("--list-models", "__pi_config_smoke_no_such_model__");

const result = runPi(args, "direct-smoke");
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout, /No models (?:matching|available)/);
assert.doesNotMatch(result.stderr, /error|failed|exception/i);

const packageResult = runPi(["-e", root, "--list-models", "__pi_config_package_smoke_no_such_model__"], "package-smoke");
if (packageResult.error) throw packageResult.error;
assert.equal(packageResult.status, 0, packageResult.stderr || packageResult.stdout);
assert.match(packageResult.stdout, /No models (?:matching|available)/);
assert.doesNotMatch(packageResult.stderr, /error|failed|exception/i);

console.log(`Loaded ${extensions.length} manifest extensions and ${promptNames.length} prompt templates directly, then loaded the complete package manifest through Pi.`);
