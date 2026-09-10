import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DefaultResourceLoader, estimateTokens } from "@earendil-works/pi-coding-agent";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const normalizeLines = (text) => text.replace(/\r\n?/g, "\n");
const gitignore = normalizeLines(await readFile(new URL("../.gitignore", import.meta.url), "utf8"));
const readme = normalizeLines(await readFile(new URL("../README.md", import.meta.url), "utf8"));
const workflow = normalizeLines(await readFile(new URL("../.github/workflows/check.yml", import.meta.url), "utf8"));
const promptNames = ["r-audit", "r-docs-rebuild", "r-ship"];
const promptPaths = promptNames.map((name) => `prompts/${name}.md`);
const policyPaths = [
  "policies/caveman.LICENSE",
  "policies/ponytail.LICENSE",
  "policies/unslop.LICENSE",
  "policies/UNSLOP.md",
];
const executable = (name) => process.platform === "win32" ? `${name}.cmd` : name;
const estimateText = (text) => estimateTokens({
  role: "user",
  content: [{ type: "text", text }],
  timestamp: 0,
});

function assertClauses(text, clauses) {
  for (const clause of clauses) assert.match(text, clause);
}

function relativeMarkdownTargets(markdown) {
  return [...markdown.matchAll(/\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().replace(/^<|>$/g, ""))
    .filter((target) => target && !target.startsWith("#") && !/^[a-z][a-z+.-]*:/i.test(target))
    .map((target) => decodeURIComponent(target.split("#", 1)[0]));
}

const ignoredDirectories = new Set([".agents", ".git", ".pi", "coverage", "dist", "node_modules"]);

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

const extensions = [
  "./extensions/ask.ts",
  "./extensions/web.ts",
  "./extensions/ponytail.ts",
  "./extensions/unslop.ts",
  "./extensions/ui.ts",
];

const packedPaths = [
  "README.md",
  "extensions/ask-core.ts",
  "extensions/ask.ts",
  "extensions/bounded-output.ts",
  "extensions/ponytail.ts",
  "extensions/text-safety.ts",
  "extensions/unslop.ts",
  "extensions/ui.ts",
  "extensions/web-core.ts",
  "extensions/web.ts",
  "package.json",
  ...policyPaths,
  ...promptPaths,
].sort();

test("only documented package resources are enabled", async () => {
  assert.deepEqual(packageJson.pi, {
    extensions,
    prompts: ["./prompts"],
  });
  assert.deepEqual(packageJson.files, ["extensions", "policies", "prompts", "README.md"]);
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.bundledDependencies, undefined);
  assert.deepEqual(packageJson.scripts, {
    test: "node --test \"test/*.test.mjs\"",
    typecheck: "tsc --noEmit",
    check: "npm run typecheck && npm test",
  });
  assert.deepEqual(packageJson.peerDependencies, {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    typebox: "*",
  });
  assert.deepEqual((await readdir(new URL("../prompts/", import.meta.url))).sort(), promptNames.map((name) => `${name}.md`));
});

test("Markdown basenames follow resource naming rules", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const prompts = join(root, "prompts");
  for (const path of await markdownFiles(root)) {
    const name = basename(path);
    const expected = dirname(path) === prompts ? name.slice(0, -3).toLowerCase() : name.slice(0, -3).toUpperCase();
    assert.equal(name, `${expected}.md`);
  }
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
    const prompts = new Map(loaded.prompts.map((prompt) => [prompt.name, prompt]));
    assert.equal(prompts.get("r-audit").argumentHint, "[scope]");
    assert.equal(prompts.get("r-docs-rebuild").argumentHint, "[scope]");
    assert.equal(prompts.get("r-ship").argumentHint, undefined);
    assert.match(prompts.get("r-docs-rebuild").description, /AGENTS\.md.*dirty/i);
    assert.match(prompts.get("r-ship").description, /merge/i);

    const piDist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
    const { expandPromptTemplate } = await import(pathToFileURL(join(piDist, "core", "prompt-templates.js")).href);
    for (const removed of ["r-docs", "r-git", "r-impl"]) {
      assert.equal(expandPromptTemplate(`/${removed}`, loaded.prompts), `/${removed}`);
    }
    const docs = expandPromptTemplate("/r-docs-rebuild", loaded.prompts);
    assertClauses(docs, [
      /Rebuild human docs and update existing `AGENTS\.md` files/,
      /Scope: entire repository/,
      /Dirty in-scope replacement needs no confirmation/,
      /tracked\/untracked\/dirty Markdown owner\/status/,
      /Protect other instruction files.*runtime prompts\/policies.*generated\/frozen.*licenses\/notices.*ignored\/vendor.*unrelated changes/s,
      /Old human docs are leads, not evidence/,
      /For in-scope `AGENTS\.md`: clarify wording and update evidenced stale facts\/references/,
      /Preserve rule meaning, safety constraints, filenames, and directory scope/,
      /Never delete these files or drop rules merely because code disagrees/,
      /Report unresolved conflicts/,
      /Uppercase Markdown basenames; lowercase `\.md`\. Rename files\/references/,
      /Prepare all replacements before writes\/deletes/,
      /Repository rules override defaults/,
      /Keep root `README\.md`; add task docs only if permitted and needed/,
      /Match the reader's technical background/,
      /Keep prerequisites and necessary detail; no fixed line count/,
      /Write drafts, then delete only obsolete in-scope human docs/,
      /Edit Markdown only/,
      /No paid calls\/deploys\/migrations\/pushes\/publishes\/live operations/,
      /Verify claims\/commands\/paths\/links\/examples; flag unverified facts/,
    ]);
    assert.match(expandPromptTemplate('/r-docs-rebuild "docs and examples"', loaded.prompts), /Scope: docs and examples\./);
    assert.match(expandPromptTemplate('/r-docs-rebuild src/AGENTS.md', loaded.prompts), /Scope: src\/AGENTS\.md\./);

    const implementation = expandPromptTemplate("/r-audit", loaded.prompts);
    assertClauses(implementation, [
      /Scope: entire repository\./,
      /No edits unless asked/,
      /Start with `README\.md` as the repository map/,
      /Read all `AGENTS\.md` files that apply to the scope/,
      /Trace the scoped implementation through its transitive callers, inputs, state, outputs, failure paths, dependencies, and focused tests/,
      /evidenced requirements, not assumptions/,
      /owner and smallest root fix\/deletion/,
      /main-feature or requirement bugs/,
      /reachable data loss/,
      /reachable trust-boundary security flaws with concrete impact/,
      /Exclude theoretical hardening, unmeasured performance, speculative scale/,
      /Order findings by impact.*exact file plus symbol or line.*evidence.*requirement impact, risk, or maintenance\/test gap.*smallest deletion\/reuse\/fix.*focused check/s,
      /Cleanup separate.*No scores or invention/s,
      /With no justified finding, report no change needed/,
    ]);
    assert.doesNotMatch(implementation, /explore entire codebase/);
    assert.ok(implementation.indexOf("Start with") < implementation.indexOf("Report only:"));
    assert.match(expandPromptTemplate("/r-audit extensions tests", loaded.prompts), /Scope: extensions tests\./);

    const git = expandPromptTemplate("/r-ship", loaded.prompts);
    assertClauses(git, [
      /Branch\/commit\/push\/PR\/merge allowed; do not confirm/,
      /staged\/unstaged\/untracked names first/,
      /Never include ignored files/,
      /Stop if candidate work has ignored.*credential\/key\/env\/auth\/settings\/session\/transcript files.*secrets/s,
      /Allow unfamiliar names/,
      /smallest coherent dependency-ordered PRs/i,
      /merge dependencies; refresh\/verify default; branch; commit only its group/,
      /run\/fix required checks.*await\/fix required CI\/reviews.*merge only green/s,
      /Preserve work.*Stop on blocked files.*Never stash\/reset\/discard\/overwrite\/force-push\/bypass/s,
      /hooks\/checks\/CI\/conflicts\/reviews\/protection/,
      /remove only clean worktrees and merged branches this run created/,
      /Keep default, active, dirty, unmerged, and pre-existing branches\/worktrees/,
      /unsafe switch\/separation\/access\/approval\/cleanup.*Report merges\/cleanup\/blockers/s,
    ]);

    const promptTokens = {
      "r-docs-rebuild": estimateText(docs),
      "r-ship": estimateText(git),
      "r-audit": estimateText(implementation),
    };
    const ceilings = { "r-docs-rebuild": 420, "r-ship": 220, "r-audit": 280 };
    for (const name of promptNames) {
      assert.ok(promptTokens[name] <= ceilings[name], `${name} estimate ${promptTokens[name]} exceeds ${ceilings[name]}`);
    }
    const total = Object.values(promptTokens).reduce((sum, tokens) => sum + tokens, 0);
    assert.ok(total <= 910, `prompt estimate ${total} exceeds 910 tokens`);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("fixed policies remain extensions and retain adaptation notices", async () => {
  assert.equal(packageJson.pi.skills, undefined);
  assert.deepEqual((await readdir(new URL("../policies/", import.meta.url))).sort(), [
    "UNSLOP.md",
    "caveman.LICENSE",
    "ponytail.LICENSE",
    "unslop.LICENSE",
  ]);
});

test("the exact production package installs and loads directly and through its Pi manifest", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const temporary = await mkdtemp(join(tmpdir(), "pi-config-production-install-"));
  const application = join(temporary, "application with spaces");
  const npmCache = join(temporary, "npm-cache");
  const piState = join(temporary, "pi-state");
  try {
    const packed = spawnSync(executable("npm"), [
      "pack", "--json", "--ignore-scripts", "--cache", npmCache, "--pack-destination", temporary,
    ], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      shell: process.platform === "win32",
    });
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const packResult = JSON.parse(packed.stdout)[0];
    assert.deepEqual(packResult.files.map((file) => file.path).sort(), packedPaths);
    const packedNames = new Set(packedPaths);
    for (const target of relativeMarkdownTargets(readme)) {
      assert.ok(packedNames.has(target), `README relative link is not packed: ${target}`);
    }

    const tarball = join(temporary, packResult.filename);
    await mkdir(application);
    await writeFile(join(application, "package.json"), '{"private":true,"type":"module"}\n');

    const installed = spawnSync(executable("npm"), [
      "install", "--prefer-offline", "--ignore-scripts", "--cache", npmCache, "--omit=dev", "--legacy-peer-deps", "--no-audit", "--no-fund", "--no-package-lock", tarball,
    ], {
      cwd: application,
      encoding: "utf8",
      timeout: 120_000,
      shell: process.platform === "win32",
    });
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);

    const packagePath = join(application, "node_modules", ...packageJson.name.split("/"));
    const runPi = (args, name) => spawnSync(executable("pi"), args, {
      cwd: application,
      encoding: "utf8",
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: join(piState, name, "agent"),
        PI_CODING_AGENT_SESSION_DIR: join(piState, name, "sessions"),
        PI_OFFLINE: "1",
      },
      timeout: 30_000,
      shell: process.platform === "win32",
    });
    const assertLoaded = (result) => {
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /No models (?:matching|available)/);
      assert.doesNotMatch(result.stderr, /error|failed|exception/i);
    };

    const directArgs = ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"];
    for (const extension of extensions) directArgs.push("--extension", join(packagePath, extension));
    for (const prompt of promptPaths) directArgs.push("--prompt-template", join(packagePath, prompt));
    directArgs.push("--list-models", "__pi_config_direct_resources__");
    assertLoaded(runPi(directArgs, "direct"));
    assertLoaded(runPi(["-e", packagePath, "--list-models", "__pi_config_package_manifest__"], "manifest"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("CI covers pinned and latest Pi with required checks", () => {
  assert.match(workflow, /^on:\n  push:\n    branches: \[main\]\n  pull_request:\n  workflow_dispatch:\n  schedule:/m);
  assert.match(workflow, /concurrency:\n  group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n  cancel-in-progress: true/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /timeout-minutes: 10/);
  assert.match(workflow, /fail-fast: false/);
  assert.equal((workflow.match(/- os: /g) ?? []).length, 3);
  for (const tuple of [
    /- os: ubuntu-latest\n\s+node: "22\.19\.0"\n\s+pi: pinned/,
    /- os: ubuntu-latest\n\s+node: "22\.x"\n\s+pi: latest/,
    /- os: windows-latest\n\s+node: "22\.19\.0"\n\s+pi: pinned/,
  ]) assert.match(workflow, tuple);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}\b/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}\b/);
  assert.match(workflow, /node-version: \$\{\{ matrix\.node \}\}/);
  assert.match(workflow, /schedule:\s+- cron:/);
  assert.match(workflow, /@earendil-works\/pi-ai@latest @earendil-works\/pi-coding-agent@latest @earendil-works\/pi-tui@latest typebox@latest/);
  assert.match(workflow, /if: matrix\.os == 'ubuntu-latest' && matrix\.node == '22\.19\.0' && matrix\.pi == 'pinned'\n\s+run: npm audit --audit-level=high/);
  assert.equal((workflow.match(/npm audit/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /npm audit --omit=dev/);
  assert.match(workflow, /- run: npm run check/);
  assert.doesNotMatch(workflow, /continue-on-error|--force|--omit=dev|test-name-pattern/);
});

test("README links to active resources and retained policy sources", () => {
  const targets = new Set(relativeMarkdownTargets(readme));
  for (const path of [...promptPaths, ...policyPaths, ...extensions.map((path) => path.slice(2))]) {
    assert.ok(targets.has(path), `README must link to ${path}`);
  }
  for (const source of ["DietrichGebert/ponytail", "JuliusBrussee/caveman", "cursor/plugins"]) {
    assert.ok(readme.includes(source), `README must credit ${source}`);
  }
});

test("sensitive Pi state and session transcripts are ignored", () => {
  const patterns = new Set(gitignore.split("\n"));
  for (const pattern of [".pi/", "sessions/", "*.jsonl", "settings.json", "models.json", "trust.json"]) {
    assert.ok(patterns.has(pattern), pattern);
  }
});
