import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");

test("only stable extensions are enabled by default", async () => {
  assert.deepEqual(packageJson.pi.extensions, [
    "./extensions/ui.ts",
    "./extensions/tools.ts",
    "./extensions/web.ts",
    "./extensions/ask.ts",
    "./extensions/subagents.ts",
  ]);
  assert.equal(packageJson.pi.prompts, undefined);
  await access(new URL("../extensions/workflows.ts", import.meta.url));
  await access(new URL("../extensions/workflows-core.ts", import.meta.url));
  await access(new URL("../subagents/workflows-registry.ts", import.meta.url));
});

test("sensitive Pi state and session transcripts are ignored", () => {
  const patterns = new Set(gitignore.split("\n"));
  for (const pattern of [".pi/", "sessions/", "*.jsonl", "settings.json", "models.json", "trust.json"]) {
    assert.ok(patterns.has(pattern), pattern);
  }
});
