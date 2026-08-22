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
const policyPaths = ["policies/unslop.md", "policies/unslop.LICENSE"];
const executable = (name) => process.platform === "win32" ? `${name}.cmd` : name;

const extensions = [
  "./extensions/ask.ts",
  "./extensions/ponytail.ts",
  "./extensions/unslop.ts",
  "./extensions/caveman.ts",
];

test("only documented package resources are enabled", async () => {
  assert.deepEqual(packageJson.pi, {
    extensions,
    prompts: ["./prompts"],
  });
  assert.deepEqual(packageJson.files, ["extensions", "policies", "prompts", "README.md"]);
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.bundledDependencies, undefined);
  assert.equal(packageJson.scripts.typecheck, "tsc --noEmit");
  assert.equal(packageJson.scripts["test:windows"], undefined);
  assert.equal(packageJson.scripts["test:live-web"], undefined);
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
      { name: "r-docs", description: "Make repository docs technical and agent-friendly", argumentHint: "[scope]" },
      { name: "r-git", description: "Split unstaged changes into PRs and merge them", argumentHint: undefined },
      { name: "r-impl", description: "Evidence-based implementation audit", argumentHint: "[scope]" },
    ]);

    const piDist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
    const { expandPromptTemplate } = await import(pathToFileURL(join(piDist, "core", "prompt-templates.js")).href);
    const docs = expandPromptTemplate("/r-docs", loaded.prompts);
    assert.match(docs, /Scope: entire repository\./);
    assert.match(docs, /Improve repository documentation\. Edit it now\./);
    assert.match(docs, /Read applicable `AGENTS\.md` files first/);
    assert.match(docs, /operational map/);
    assert.match(docs, /two to four concrete sentences naming inputs, outputs, and optional behavior/);
    assert.match(docs, /`Current state`:[\s\S]*`Flow`:[\s\S]*`Code`:[\s\S]*`Setup and checks`:[\s\S]*`Run`:/);
    assert.match(docs, /Preserve generation markers/);
    assert.match(docs, /Use tables only for column comparisons/);
    assert.match(docs, /Item \| Current value/);
    assert.match(docs, /Area \| Source \| Tests/);
    assert.match(docs, /grouped by reader task/);
    assert.match(docs, /paid calls, deploys, migrations, pushes, and live operations/);
    assert.match(docs, /active Caveman policy/);
    assert.match(docs, /Keep non-root Markdown scoped to its area/);
    assert.match(docs, /useful canonical first-party sources beside claims/);
    assert.match(docs, /Do not merge, move, or delete Markdown unless scope explicitly requests it/);
    assert.match(docs, /Omit unchanged-file lists/);
    assert.match(expandPromptTemplate('/r-docs "docs and examples"', loaded.prompts), /Scope: docs and examples\./);

    const implementation = expandPromptTemplate("/r-impl extensions tests", loaded.prompts);
    assert.match(implementation, /Scope: extensions tests\./);
    assert.match(implementation, /Score each category independently out of 10/);
    for (const category of ["Correctness", "Simplicity", "Maintainability", "Tests", "Performance", "Security"]) {
      assert.match(implementation, new RegExp(`^- ${category}$`, "m"));
    }
    assert.match(implementation, /evidence and a short rationale for every score/i);
    assert.match(implementation, /callers, inputs, state changes, outputs, and failure paths/);
    assert.match(implementation, /whether the behavior belongs in its current owner/);
    assert.match(implementation, /Severity: critical, high, medium, or low/);
    assert.match(implementation, /Confidence: high, medium, or low/);
    assert.match(implementation, /Observed behavior/);
    assert.match(implementation, /Concrete impact/);
    assert.match(implementation, /Smallest root-cause fix/);
    assert.match(implementation, /Verification method/);
    assert.match(implementation, /Keep bugs, security flaws, and data-loss risks separate/);
    assert.match(implementation, /`not applicable`/);
    assert.match(implementation, /`not verified`/);
    assert.match(implementation, /important branches, failure paths, boundaries, and regressions/);
    assert.match(implementation, /Do not use test count as evidence of quality/);
    assert.match(implementation, /If there are no actionable findings, state that explicitly/);
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

test("Unslop is packaged as a plain extension policy", async () => {
  const policy = normalizeLines(await readFile(new URL("../policies/unslop.md", import.meta.url), "utf8"));
  assert.match(policy, /^# Unslop\n/);
  assert.doesNotMatch(policy, /^---\n/);
  assert.equal(packageJson.pi.skills, undefined);
  assert.deepEqual((await readdir(new URL("../policies/", import.meta.url))).sort(), ["unslop.LICENSE", "unslop.md"]);
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
      ...policyPaths,
    ]) assert.ok(names.has(path), path);
    assert.equal([...names].some((path) => /^(?:test|themes|skills|\.github|extensions\/subagents)\//.test(path)), false);
    assert.equal([...names].some((path) => /^node_modules\/(?:@earendil-works|@anthropic-ai|@aws-sdk)\//.test(path)), false);
    for (const path of [
      "AGENTS.md",
      ".gitignore",
      "package-lock.json",
      "settings.json",
    ]) {
      assert.equal(names.has(path), false, path);
    }
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
  assert.match(workflow, /typebox@latest/);
  assert.match(workflow, /npm audit --omit=dev/);
  assert.match(workflow, /- run: npm run check/);
  assert.doesNotMatch(workflow, /test:windows/);
  assert.equal(packageJson.scripts["test:live-subagent"], undefined);
  assert.doesNotMatch(workflow, /runner\.os != 'Windows'|test-name-pattern/);
  assert.doesNotMatch(workflow, /curl|Install fd|live-web|PI_LIVE_WEB/);

  for (const path of [...promptPaths, ...policyPaths]) await access(new URL(`../${path}`, import.meta.url));
  assert.match(readme, /\]\(prompts\/\)/);
  assert.match(readme, /\]\(policies\/unslop\.md\)/);
  assert.doesNotMatch(readme, /\/skill:unslop|hidden from automatic model invocation/);
  assert.match(readme, /prompt policy, not a command blocker/);
  assert.match(readme, /does not include the Caveman proxy or Engine/);
  for (const source of ["DietrichGebert/ponytail", "JuliusBrussee/caveman", "cursor/plugins"]) assert.match(readme, new RegExp(source));
  for (const command of promptNames) assert.match(readme, new RegExp(`/${command}(?:\\s|\\[|\\x60)`));
  assert.doesNotMatch(readme, /subagent|parallel_agents|agent_patch|PI_LIVE_SUBAGENT/i);
  assert.doesNotMatch(readme, /web_search|web_fetch|PI_LIVE_WEB|\bExa\b|\bParallel\b|\bDuckDuckGo\b|extensions\/fast|\/fast|--fast|service_tier|themes\//i);
});

test("sensitive Pi state and session transcripts are ignored", () => {
  const patterns = new Set(gitignore.split("\n"));
  for (const pattern of [".pi/", "sessions/", "*.jsonl", "settings.json", "models.json", "trust.json"]) {
    assert.ok(patterns.has(pattern), pattern);
  }
});
