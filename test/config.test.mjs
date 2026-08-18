import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const normalizeLines = (text) => text.replace(/\r\n?/g, "\n");
const gitignore = normalizeLines(await readFile(new URL("../.gitignore", import.meta.url), "utf8"));
const readme = normalizeLines(await readFile(new URL("../README.md", import.meta.url), "utf8"));
const workflow = normalizeLines(await readFile(new URL("../.github/workflows/check.yml", import.meta.url), "utf8"));
const promptNames = ["r-docs", "r-git", "r-impl"];
const promptPaths = promptNames.map((name) => `prompts/${name}.md`);
const skillPath = "skills/ponytail/SKILL.md";
const executable = (name) => process.platform === "win32" ? `${name}.cmd` : name;

const extensions = [
  "./extensions/tools.ts",
  "./extensions/web.ts",
  "./extensions/ask.ts",
  "./extensions/todo.ts",
  "./extensions/goal.ts",
  "./extensions/layout.ts",
  "./extensions/concise.ts",
  "./extensions/ponytail.ts",
];

test("only frozen-scope resources are enabled", async () => {
  assert.deepEqual(packageJson.pi, {
    extensions,
    prompts: ["./prompts"],
    skills: ["./skills/ponytail/SKILL.md"],
  });
  assert.deepEqual(packageJson.files, ["extensions", "prompts", "skills", "README.md"]);
  assert.deepEqual(packageJson.dependencies, { linkedom: "0.18.13" });
  assert.deepEqual(packageJson.peerDependencies, {
    "@earendil-works/pi-ai": ">=0.84.2",
    "@earendil-works/pi-coding-agent": ">=0.84.2",
    "@earendil-works/pi-tui": ">=0.84.2",
    typebox: ">=1.3.14",
  });
  assert.deepEqual((await readdir(new URL("../prompts/", import.meta.url))).sort(), promptNames.map((name) => `${name}.md`));
  assert.deepEqual(await readdir(new URL("../skills/", import.meta.url)), ["ponytail"]);
  const ponytailSkill = await readFile(new URL(`../${skillPath}`, import.meta.url), "utf8");
  assert.match(ponytailSkill, /disable-model-invocation: true/);
});

test("workflow prompts load and expand through Pi's built-in templates", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-config-prompts-"));
  try {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      additionalPromptTemplatePaths: [join(root, "prompts")],
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    const loaded = loader.getPrompts();
    assert.deepEqual(loaded.diagnostics, []);
    assert.deepEqual(loaded.prompts.map(({ name }) => name), promptNames);
    assert.deepEqual(loaded.prompts.map(({ name, description, argumentHint }) => ({ name, description, argumentHint })), [
      { name: "r-docs", description: "Audit and simplify repository documentation", argumentHint: "[scope]" },
      { name: "r-git", description: "Turn safe working-tree changes into coherent PRs and merge them", argumentHint: undefined },
      { name: "r-impl", description: "Evidence-based implementation audit", argumentHint: "[scope]" },
    ]);

    const piDist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
    const { expandPromptTemplate } = await import(pathToFileURL(join(piDist, "core", "prompt-templates.js")).href);
    const docs = expandPromptTemplate("/r-docs", loaded.prompts);
    assert.match(docs, /Scope: entire repository\./);
    assert.match(docs, /Inventory every `\.md` file in scope/);
    assert.match(expandPromptTemplate('/r-docs "docs and examples"', loaded.prompts), /Scope: docs and examples\./);

    const implementation = expandPromptTemplate("/r-impl extensions tests", loaded.prompts);
    assert.match(implementation, /Scope: extensions tests\./);
    assert.match(implementation, /Score each category independently out of 10/);
    for (const category of ["Correctness", "Simplicity", "Maintainability", "Tests", "Performance", "Security"]) {
      assert.match(implementation, new RegExp(`^- ${category}$`, "m"));
    }
    assert.match(implementation, /evidence and a short rationale for every score/i);
    assert.doesNotMatch(implementation, /Correctness: 3|Tests: 1/);

    const git = expandPromptTemplate("/r-git", loaded.prompts);
    assert.match(git, /^Turn safe working-tree changes/);
    assert.match(git, /staged and unstaged changes, untracked files/);
    assert.match(git, /Invocation authorizes commits, pushes, pull request creation, and merges/);
    assert.match(git, /Stop when intent, ownership, target, separation, authentication, conflicts, repository rules, or secret safety cannot be verified/);
    assert.doesNotMatch(git, /^Process all unstaged and untracked work/);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("extension source uses only approved special UI glyphs", async () => {
  const approved = new Set(Array.from("□■☒⎿├─│└〉"));
  const files = (await readdir(new URL("../extensions/", import.meta.url))).filter((name) => name.endsWith(".ts"));
  for (const file of files) {
    const source = await readFile(new URL(`../extensions/${file}`, import.meta.url), "utf8");
    for (const glyph of source.match(/[^\x00-\x7f]/gu) ?? []) assert.ok(approved.has(glyph), `${file}: ${glyph}`);
  }
});

test("package contents include runtime resources and exclude repository-only state", async () => {
  const cache = await mkdtemp(join(tmpdir(), "pi-config-pack-cache-"));
  try {
    const result = spawnSync(executable("npm"), ["pack", "--dry-run", "--json", "--ignore-scripts", "--cache", cache], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      timeout: 30_000,
      shell: process.platform === "win32",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const names = new Set(JSON.parse(result.stdout)[0].files.map((file) => file.path));
    for (const path of [
      "package.json",
      "README.md",
      ...extensions.map((path) => path.replace(/^\.\//, "")),
      "extensions/text-safety.ts",
      ...promptPaths,
      skillPath,
    ]) assert.ok(names.has(path), path);
    assert.equal([...names].some((path) => /^(?:test|subagents|themes|\.github)\//.test(path)), false);
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
    const packed = spawnSync(executable("npm"), ["pack", "--json", "--ignore-scripts", "--pack-destination", temporary], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      shell: process.platform === "win32",
    });
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const tarball = join(temporary, JSON.parse(packed.stdout)[0].filename);
    await mkdir(application);
    await writeFile(join(application, "package.json"), '{"private":true,"type":"module"}\n');

    const installed = spawnSync(executable("npm"), [
      "install", "--prefer-offline", "--ignore-scripts", "--omit=dev", "--legacy-peer-deps", "--no-audit", "--no-fund", "--no-package-lock", tarball,
    ], {
      cwd: application,
      encoding: "utf8",
      timeout: 120_000,
      shell: process.platform === "win32",
    });
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);

    const packagePath = join(application, "node_modules", ...packageJson.name.split("/"));
    const loaded = spawnSync(executable("pi"), ["-e", packagePath, "--list-models", "__pi_config_production_install__"], {
      cwd: application,
      encoding: "utf8",
      env: { ...process.env, PI_OFFLINE: "1" },
      timeout: 30_000,
      shell: process.platform === "win32",
    });
    assert.equal(loaded.status, 0, loaded.stderr || loaded.stdout);
    assert.match(loaded.stdout, /No models (?:matching|available)/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("CI checks pushes and the human guide matches runtime scope", async () => {
  assert.match(workflow, /^on:\n  push:\n  pull_request:/m);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40} # v7\.0\.0/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40} # v7\.0\.0/);
  assert.match(workflow, /node: \["22\.19\.0", "22\.x"\]/);
  assert.match(workflow, /node-version: \$\{\{ matrix\.node \}\}/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /schedule:\n    - cron: "17 9 \* \* 1"/);
  assert.match(workflow, /live-web:[\s\S]*continue-on-error: true[\s\S]*PI_LIVE_WEB: "1"/);
  assert.match(workflow, /typebox@latest/);
  assert.match(workflow, /npm audit --omit=dev/);
  assert.match(workflow, /- run: npm run check/);
  assert.match(workflow, /npm run test:windows/);
  assert.doesNotMatch(workflow, /runner\.os != 'Windows'|test-name-pattern/);
  assert.doesNotMatch(workflow, /curl|Install fd/);

  for (const path of [...promptPaths, skillPath]) await access(new URL(`../${path}`, import.meta.url));
  assert.match(readme, /\]\(prompts\/\)/);
  assert.match(readme, /\]\(skills\/ponytail\/SKILL\.md\)/);
  for (const command of promptNames) assert.match(readme, new RegExp(`/${command}(?:\\s|\\[|\\x60)`));
  assert.doesNotMatch(readme, /subagents|web_fetch|themes\//i);
  for (const pattern of [
    /Goal mode has no automatic run ceiling/,
    /It can use every active tool and provider quota/,
    /Never send secrets or private code through `web_search`/,
    /retains at most 10 truncated outputs or 50MB per session/,
    /built-in `grep` and `find`/,
    /PI_LIVE_WEB=1/,
    /weekly and on manual dispatch.*non-blocking provider-drift signals/,
  ]) assert.match(readme, pattern);
});

test("sensitive Pi state and session transcripts are ignored", () => {
  const patterns = new Set(gitignore.split("\n"));
  for (const pattern of [".pi/", "sessions/", "*.jsonl", "settings.json", "models.json", "trust.json"]) {
    assert.ok(patterns.has(pattern), pattern);
  }
});
