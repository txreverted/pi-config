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
const skillNames = ["unslop"];
const skillPaths = skillNames.map((name) => `skills/${name}/SKILL.md`);
const executable = (name) => process.platform === "win32" ? `${name}.cmd` : name;

const extensions = [
  "./extensions/web.ts",
  "./extensions/ask.ts",
  "./extensions/layout.ts",
  "./extensions/concise.ts",
  "./extensions/unslop.ts",
  "./extensions/ponytail.ts",
  "./node_modules/pi-context-view/src/index.ts",
];

test("only documented package resources are enabled", async () => {
  assert.deepEqual(packageJson.pi, {
    extensions,
    prompts: ["./prompts"],
    skills: ["./skills"],
  });
  assert.deepEqual(packageJson.files, ["extensions", "prompts", "skills", "README.md"]);
  assert.deepEqual(packageJson.dependencies, {
    linkedom: "0.18.13",
    "pi-context-view": "0.4.3",
  });
  assert.deepEqual(packageJson.bundledDependencies, ["pi-context-view"]);
  assert.equal(packageJson.scripts.typecheck, "tsc --noEmit");
  assert.equal(packageJson.scripts["test:windows"], undefined);
  assert.deepEqual(packageJson.peerDependencies, {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    typebox: "*",
  });
  assert.deepEqual((await readdir(new URL("../prompts/", import.meta.url))).sort(), promptNames.map((name) => `${name}.md`));
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
      { name: "r-docs", description: "Make repository docs terse and agent-first", argumentHint: "[scope]" },
      { name: "r-git", description: "Split unstaged changes into PRs and merge them", argumentHint: undefined },
      { name: "r-impl", description: "Evidence-based implementation audit", argumentHint: "[scope]" },
    ]);

    const piDist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
    const { expandPromptTemplate } = await import(pathToFileURL(join(piDist, "core", "prompt-templates.js")).href);
    const docs = expandPromptTemplate("/r-docs", loaded.prompts);
    assert.match(docs, /Scope: entire repository\./);
    assert.match(docs, /Simplify the repository documentation\. Edit it now\./);
    assert.match(docs, /Read every applicable `AGENTS\.md` first/);
    assert.match(docs, /Write for coding agents first/);
    assert.match(docs, /Link every other tracked project `\.md` file with a relative link/);
    assert.match(docs, /Keep an external source only when it supports a retained claim/);
    assert.match(docs, /Remove redundant docs, source, release, changelog, and migration links/);
    assert.match(docs, /Omit unchanged-file lists/);
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
    assert.match(git, /^Analyze every unstaged change and untracked file/);
    assert.match(git, /Group them by intent into the smallest coherent pull requests/);
    assert.match(git, /Create a branch from the verified default branch/);
    assert.match(git, /Commit only that group/);
    assert.match(git, /Push the branch, open a pull request, and merge it/);
    assert.match(git, /Run no local checks/);
    assert.match(git, /Report merged pull requests and blockers/);
    assert.doesNotMatch(git, /Run relevant tests|Wait for required checks/);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("writing skill loads through Pi", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-config-skills-"));
  try {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      additionalSkillPaths: [join(root, "skills")],
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    const loaded = loader.getSkills();
    assert.deepEqual(loaded.diagnostics, []);
    assert.deepEqual(loaded.skills.map(({ name, description }) => ({ name, description })), [
      { name: "unslop", description: "Detailed reference for removing AI writing tells. Use for prose edits or when the user invokes /skill:unslop." },
    ]);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("extension source uses only approved special UI glyphs", async () => {
  const approved = new Set(Array.from("□■☒⎿├─│└〉·"));
  const extensionRoot = fileURLToPath(new URL("../extensions/", import.meta.url));
  const files = (await readdir(extensionRoot, { recursive: true })).filter((name) => name.endsWith(".ts"));
  for (const file of files) {
    const source = await readFile(join(extensionRoot, file), "utf8");
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
      ...skillPaths,
    ]) assert.ok(names.has(path), path);
    assert.equal([...names].some((path) => /^(?:test|themes|\.github|extensions\/subagents)\//.test(path)), false);
    assert.equal([...names].some((path) => /^node_modules\/(?:@earendil-works|@anthropic-ai|@aws-sdk)\//.test(path)), false);
    for (const path of [
      "AGENTS.md",
      ".gitignore",
      "package-lock.json",
      "settings.json",
    ]) {
      assert.equal(names.has(path), false, path);
    }
    for (const path of [
      "node_modules/pi-context-view/src/index.ts",
      "node_modules/pi-context-view/src/ui/usage-view.ts",
    ]) assert.ok(names.has(path), path);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test("production tarball installs without dev dependencies and loads through Pi", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const temporary = await mkdtemp(join(tmpdir(), "pi-config-production-install-"));
  const application = join(temporary, "application with spaces");
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
  assert.doesNotMatch(workflow, /test:windows/);
  assert.equal(packageJson.scripts["test:live-subagent"], undefined);
  assert.doesNotMatch(workflow, /runner\.os != 'Windows'|test-name-pattern/);
  assert.doesNotMatch(workflow, /curl|Install fd/);

  for (const path of [...promptPaths, ...skillPaths]) await access(new URL(`../${path}`, import.meta.url));
  assert.match(readme, /\]\(prompts\/\)/);
  assert.match(readme, /\/skill:unslop/);
  assert.match(readme, /prompt policy, not a command blocker/);
  for (const command of promptNames) assert.match(readme, new RegExp(`/${command}(?:\\s|\\[|\\x60)`));
  assert.doesNotMatch(readme, /subagent|parallel_agents|agent_patch|PI_LIVE_SUBAGENT/i);
  assert.doesNotMatch(readme, /web_fetch|themes\//i);
  for (const pattern of [
    /Never send secrets or private code through `web_search`/,
    /No background code index runs/,
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
