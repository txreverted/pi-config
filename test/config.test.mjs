import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/check.yml", import.meta.url), "utf8");
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
    "./extensions/task.ts",
    "./extensions/goal.ts",
    "./extensions/concise.ts",
    "./extensions/ponytail.ts",
  ]);
  assert.deepEqual(packageJson.peerDependencies, {
    "@earendil-works/pi-ai": ">=0.84.2",
    "@earendil-works/pi-coding-agent": ">=0.84.2",
    "@earendil-works/pi-tui": ">=0.84.2",
    typebox: ">=1.3.14",
  });
  assert.deepEqual(packageJson.pi.skills, ["./skills"]);
  assert.deepEqual(packageJson.pi.prompts, ["./prompts"]);
  assert.deepEqual(packageJson.pi.themes, themeNames.map((name) => `./themes/${name}.json`));
  assert.deepEqual(packageJson.files, ["assets", "extensions", "prompts", "skills", "subagents", "themes", "README.md"]);
  assert.deepEqual((await readdir(new URL("../prompts/", import.meta.url))).sort(), [
    "implement-review.md",
    "list-improvements.md",
    "research.md",
    "review.md",
    "rework-docs.md",
  ]);
  assert.deepEqual((await readdir(new URL("../skills/", import.meta.url))).sort(), [
    "ponytail",
    "ponytail-audit",
    "ponytail-debt",
    "ponytail-help",
    "ponytail-review",
  ]);
  for (const skill of ["ponytail", "ponytail-review", "ponytail-audit", "ponytail-debt", "ponytail-help"]) {
    await access(new URL(`../skills/${skill}/SKILL.md`, import.meta.url));
  }
  const ponytailSkill = await readFile(new URL("../skills/ponytail/SKILL.md", import.meta.url), "utf8");
  assert.match(ponytailSkill, /disable-model-invocation: true/);
  await access(new URL("../extensions/subagents.ts", import.meta.url));
  await access(new URL("../extensions/subagents-core.ts", import.meta.url));
});

test("package contents include runtime resources and exclude repository-only state", async () => {
  const cache = await mkdtemp(join(tmpdir(), "pi-config-pack-cache-"));
  try {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts", "--cache", cache], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const names = new Set(JSON.parse(result.stdout)[0].files.map((file) => file.path));
    for (const path of [
      "package.json",
      "README.md",
      "assets/pi-config.png",
      ...packageJson.pi.extensions.map((path) => path.replace(/^\.\//, "")),
      ...packageJson.pi.themes.map((path) => path.replace(/^\.\//, "")),
      "extensions/text-safety.ts",
      "subagents/registry.ts",
      "subagents/prompts/worker.md",
      "prompts/rework-docs.md",
      "skills/ponytail/SKILL.md",
    ]) assert.ok(names.has(path), path);
    assert.equal([...names].some((path) => /^(?:test|\.github)\//.test(path)), false);
    for (const path of ["AGENTS.md", ".gitignore", "package-lock.json", "settings.json"]) {
      assert.equal(names.has(path), false, path);
    }
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test("production tarball installs without dev dependencies and loads through Pi", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const temporary = await mkdtemp(join(tmpdir(), "pi-config-production-install-"));
  const application = join(temporary, "application");
  try {
    const packed = spawnSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temporary], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const tarball = join(temporary, JSON.parse(packed.stdout)[0].filename);
    await mkdir(application);
    await writeFile(join(application, "package.json"), '{"private":true,"type":"module"}\n');

    const installed = spawnSync("npm", [
      "install", "--prefer-offline", "--ignore-scripts", "--omit=dev", "--legacy-peer-deps", "--no-audit", "--no-fund", "--no-package-lock", tarball,
    ], {
      cwd: application,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);

    const packagePath = join(application, "node_modules", ...packageJson.name.split("/"));
    const loaded = spawnSync("pi", [
      "-e", packagePath,
      "--no-skills",
      "--list-models", "__pi_config_production_install__",
    ], {
      cwd: application,
      encoding: "utf8",
      env: { ...process.env, PI_OFFLINE: "1" },
      timeout: 30_000,
    });
    assert.equal(loaded.status, 0, loaded.stderr || loaded.stdout);
    assert.match(loaded.stdout, /No models (?:matching|available)/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
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
  assert.equal(resolved("userMessageBg"), "#000000");
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

test("CI checks pushes and the human guide keeps operational safety facts", () => {
  assert.match(workflow, /^on:\n  push:\n  pull_request:/m);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40} # v7\.0\.0/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40} # v7\.0\.0/);
  assert.match(workflow, /node: \["22\.19\.0", "22\.x"\]/);
  assert.match(workflow, /node-version: \$\{\{ matrix\.node \}\}/);
  assert.match(workflow, /typebox@latest/);
  assert.match(workflow, /npm audit --omit=dev/);
  assert.doesNotMatch(workflow, /curl|Install fd/);
  for (const pattern of [
    /worker.*local user's privileges/i,
    /context, not operating-system permissions/i,
    /Active subagents have no time, token, cost, turn, or tool-call ceiling/,
    /Goal mode can use every active tool and provider quota/,
    /Productive runs continue until completion/,
    /Never send secrets or private code through `web_search`/,
    /Never pass signed URLs or private query tokens to `web_fetch`/,
    /web_fetch` fails closed when an HTTP proxy is configured/,
    /built-in `find` and `grep` tools/,
    /exact black \(`#000000`\)/,
    /No config widget or footer renders below the editor/,
    /Pi-native transcript layout, dialogs, loaders, warnings/,
    /`outputPad: 1` and `editorPaddingX: 0`/,
    /`tuiMode: "regular"`/,
    /PI_LIVE_SUBAGENT_WORKER=1/,
    /PI_LIVE_WEB=1/,
  ]) assert.match(readme, pattern);
});

test("sensitive Pi state and session transcripts are ignored", () => {
  const patterns = new Set(gitignore.split("\n"));
  for (const pattern of [".pi/", "sessions/", "*.jsonl", "settings.json", "models.json", "trust.json"]) {
    assert.ok(patterns.has(pattern), pattern);
  }
});
