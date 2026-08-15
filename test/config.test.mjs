import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");

test("only productionized extensions and bounded workflow prompts are enabled", async () => {
  assert.deepEqual(packageJson.pi.extensions, [
    "./extensions/ui.ts",
    "./extensions/tools.ts",
    "./extensions/web.ts",
    "./extensions/ask.ts",
    "./extensions/orchestration.ts",
  ]);
  assert.deepEqual(packageJson.pi.prompts, ["./prompts"]);
  await access(new URL("../extensions/orchestration.ts", import.meta.url));
  await access(new URL("../extensions/orchestration-core.ts", import.meta.url));
  await access(new URL("../extensions/orchestration-runtime.ts", import.meta.url));
  await access(new URL("../extensions/workflow-host.ts", import.meta.url));
});

test("sensitive Pi state and session transcripts are ignored", () => {
  const patterns = new Set(gitignore.split("\n"));
  for (const pattern of [".pi/", "sessions/", "*.jsonl", "settings.json", "models.json", "trust.json"]) {
    assert.ok(patterns.has(pattern), pattern);
  }
});
