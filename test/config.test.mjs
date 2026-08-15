import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");

test("only productionized extensions, skills, and prompts are enabled", async () => {
  assert.deepEqual(packageJson.pi.extensions, [
    "./extensions/ui.ts",
    "./extensions/tools.ts",
    "./extensions/web.ts",
    "./extensions/ask.ts",
    "./extensions/subagents.ts",
    "./extensions/concise.ts",
    "./extensions/ponytail.ts",
  ]);
  assert.deepEqual(packageJson.pi.skills, ["./skills"]);
  assert.deepEqual(packageJson.pi.prompts, ["./prompts"]);
  assert.deepEqual((await readdir(new URL("../prompts/", import.meta.url))).sort(), [
    "implement-review.md",
    "list-improvements.md",
    "research.md",
    "review.md",
    "rework-docs.md",
  ]);
  for (const skill of ["ponytail", "ponytail-review", "ponytail-audit", "ponytail-debt", "ponytail-gain", "ponytail-help"]) {
    await access(new URL(`../skills/${skill}/SKILL.md`, import.meta.url));
  }
  const ponytailSkill = await readFile(new URL("../skills/ponytail/SKILL.md", import.meta.url), "utf8");
  assert.match(ponytailSkill, /disable-model-invocation: true/);
  await access(new URL("../extensions/subagents.ts", import.meta.url));
  await access(new URL("../extensions/subagents-core.ts", import.meta.url));
});

test("sensitive Pi state and session transcripts are ignored", () => {
  const patterns = new Set(gitignore.split("\n"));
  for (const pattern of [".pi/", "sessions/", "*.jsonl", "settings.json", "models.json", "trust.json"]) {
    assert.ok(patterns.has(pattern), pattern);
  }
});
