import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
const themeNames = ["neutral"];
const themes = await Promise.all(themeNames.map(async (name) =>
  JSON.parse(await readFile(new URL(`../themes/${name}.json`, import.meta.url), "utf8"))
));

test("only productionized extensions, skills, and prompts are enabled", async () => {
  assert.deepEqual(packageJson.pi.extensions, [
    "./extensions/ui.ts",
    "./extensions/tools.ts",
    "./extensions/web.ts",
    "./extensions/ask.ts",
    "./extensions/subagents.ts",
    "./extensions/todo.ts",
    "./extensions/goal.ts",
    "./extensions/concise.ts",
    "./extensions/ponytail.ts",
  ]);
  assert.deepEqual(packageJson.pi.skills, ["./skills"]);
  assert.deepEqual(packageJson.pi.prompts, ["./prompts"]);
  assert.deepEqual(packageJson.pi.themes, themeNames.map((name) => `./themes/${name}.json`));
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

test("theme stays neutral except for added and removed diff lines", () => {
  const luminance = (hex) => {
    const [r, g, b] = hex.match(/\w\w/g).map((value) => Number.parseInt(value, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (foreground, background) => {
    const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
  };

  assert.deepEqual(themes.map(({ name }) => name), themeNames);
  const theme = themes[0];
  const resolved = (token) => theme.vars[theme.colors[token]] ?? theme.colors[token];
  assert.equal(new Set(["success", "error", "warning"].map(resolved)).size, 3);
  assert.equal(new Set(["userMessageBg", "customMessageBg", "toolSuccessBg", "toolErrorBg"].map(resolved)).size, 4);
  assert.equal(resolved("toolPendingBg"), resolved("toolSuccessBg"));
  assert.notEqual(resolved("toolPendingBg"), resolved("userMessageBg"));
  for (const token of ["text", "muted", "dim", "thinkingText", "syntaxComment"]) {
    assert.ok(contrast(resolved(token), theme.vars.base) >= 4.5, token);
  }
  for (const token of Object.keys(theme.colors)) {
    if (token === "toolDiffAdded" || token === "toolDiffRemoved") continue;
    const [red, green, blue] = resolved(token).match(/\w\w/g);
    assert.equal(red, green, token);
    assert.equal(green, blue, token);
  }
});

test("sensitive Pi state and session transcripts are ignored", () => {
  const patterns = new Set(gitignore.split("\n"));
  for (const pattern of [".pi/", "sessions/", "*.jsonl", "settings.json", "models.json", "trust.json"]) {
    assert.ok(patterns.has(pattern), pattern);
  }
});
