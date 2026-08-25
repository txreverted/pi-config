import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DefaultResourceLoader, estimateTokens } from "@earendil-works/pi-coding-agent";
import { PONYTAIL_INSTRUCTIONS } from "../extensions/ponytail.ts";
import { UNSLOP_INSTRUCTIONS } from "../extensions/unslop.ts";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const normalizeLines = (text) => text.replace(/\r\n?/g, "\n");
const gitignore = normalizeLines(await readFile(new URL("../.gitignore", import.meta.url), "utf8"));
const readme = normalizeLines(await readFile(new URL("../README.md", import.meta.url), "utf8"));
const workflow = normalizeLines(await readFile(new URL("../.github/workflows/check.yml", import.meta.url), "utf8"));
const tsconfig = JSON.parse(await readFile(new URL("../tsconfig.json", import.meta.url), "utf8"));
const promptNames = ["r-docs", "r-git", "r-impl"];
const promptPaths = promptNames.map((name) => `prompts/${name}.md`);
const policyPaths = [
  "policies/caveman.LICENSE",
  "policies/ponytail.LICENSE",
  "policies/unslop.LICENSE",
  "policies/unslop.md",
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

const extensions = [
  "./extensions/ask.ts",
  "./extensions/ui.ts",
  "./extensions/ponytail.ts",
  "./extensions/unslop.ts",
];

const packedPaths = [
  "README.md",
  "extensions/ask-core.ts",
  "extensions/ask.ts",
  "extensions/ui.ts",
  "extensions/ponytail.ts",
  "extensions/text-safety.ts",
  "extensions/unslop.ts",
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
  assert.equal(packageJson.keywords, undefined);
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.bundledDependencies, undefined);
  assert.deepEqual(packageJson.scripts, {
    test: "node --test \"test/*.test.mjs\"",
    typecheck: "tsc --noEmit",
    check: "npm run typecheck && npm test",
  });
  assert.deepEqual(packageJson.peerDependencies, {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    typebox: "*",
  });
  assert.deepEqual(packageJson.devDependencies, {
    "@earendil-works/pi-coding-agent": "0.84.2",
    "@earendil-works/pi-tui": "0.84.2",
    "@types/node": "22.20.1",
    typebox: "1.3.14",
    typescript: "5.9.3",
  });
  assert.deepEqual(tsconfig.compilerOptions.lib, ["ES2023"]);
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
      { name: "r-docs", description: "Rebuild and replace documentation, including dirty files", argumentHint: "[scope]" },
      { name: "r-git", description: "Split dirty work into checked PRs and merge them", argumentHint: undefined },
      { name: "r-impl", description: "Audit core behavior and implementation size", argumentHint: "[scope]" },
    ]);

    const piDist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
    const { expandPromptTemplate } = await import(pathToFileURL(join(piDist, "core", "prompt-templates.js")).href);
    const docs = expandPromptTemplate("/r-docs", loaded.prompts);
    assertClauses(docs, [
      /Scope: entire repository/,
      /dirty in-scope replacement without confirmation/,
      /tracked\/untracked\/dirty Markdown owner\/status/,
      /Protect .*instructions.*runtime prompts\/policies.*generated\/frozen.*licenses\/notices.*ignored\/vendor.*unrelated changes/s,
      /Old docs are leads, not evidence/,
      /Prepare all replacements before writes\/deletes/,
      /Keep root `README\.md`.*docs for separate tasks/s,
      /Edit Markdown only/,
      /No paid calls\/deploys\/migrations\/pushes\/publishes\/live operations/,
      /Verify claims\/commands\/paths\/links\/examples/,
    ]);
    assert.match(expandPromptTemplate('/r-docs "docs and examples"', loaded.prompts), /Scope: docs and examples\./);

    const implementation = expandPromptTemplate("/r-impl", loaded.prompts);
    assertClauses(implementation, [
      /Scope: entire repository\./,
      /Do not edit unless explicitly asked/,
      /requirements\/supported behavior from code\/config\/tests\/repo rules, not assumptions/,
      /caller\/input\/state\/output\/failure paths/,
      /owner and smallest root fix\/deletion/,
      /main-feature\/requirement bugs/,
      /reachable trust-boundary data loss\/security flaws/,
      /Exclude theoretical hardening, unmeasured performance, speculative scale/,
      /exact file\/symbol or line.*behavior\/evidence.*smallest fix.*focused check/s,
      /Separate cleanup.*No scores or invented findings/s,
      /If no small fix is justified, report no change needed/,
    ]);
    assert.match(expandPromptTemplate("/r-impl extensions tests", loaded.prompts), /Scope: extensions tests\./);

    const git = expandPromptTemplate("/r-git", loaded.prompts);
    assertClauses(git, [
      /Branch\/commit\/push\/PR\/merge allowed; do not confirm/,
      /staged\/unstaged\/untracked names first/,
      /Stop on .*credentials\/keys.*auth\/settings.*sessions\/transcripts.*content secrets/s,
      /Smallest coherent PRs, dependency ordered/,
      /merge dependencies; refresh\/verify default; branch; commit only its group/,
      /run\/fix required checks.*await\/fix required CI\/reviews.*merge only green/s,
      /Preserve work.*Stop on blocked files.*Never stash\/reset\/discard\/overwrite\/force-push\/bypass/s,
      /hooks\/checks\/CI\/conflicts\/reviews\/protection/,
      /unsafe switch\/separation\/access\/approval.*Report merges\/blockers/s,
    ]);

    const promptTokens = {
      "r-docs": estimateText(docs),
      "r-git": estimateText(git),
      "r-impl": estimateText(implementation),
    };
    const ceilings = { "r-docs": 340, "r-git": 164, "r-impl": 280 };
    for (const name of promptNames) {
      assert.ok(promptTokens[name] <= ceilings[name], `${name} estimate ${promptTokens[name]} exceeds ${ceilings[name]}`);
    }
    const total = Object.values(promptTokens).reduce((sum, tokens) => sum + tokens, 0);
    assert.ok(total <= 775, `prompt estimate ${total} exceeds 775 tokens`);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("fixed policies remain extensions, carry their notices, and stay within budget", async () => {
  const policy = normalizeLines(await readFile(new URL("../policies/unslop.md", import.meta.url), "utf8"));
  assert.match(policy, /^Repo style and requested format win\./);
  assert.doesNotMatch(policy, /^---\n/);
  assert.equal(packageJson.pi.skills, undefined);
  assert.deepEqual((await readdir(new URL("../policies/", import.meta.url))).sort(), [
    "caveman.LICENSE",
    "ponytail.LICENSE",
    "unslop.LICENSE",
    "unslop.md",
  ]);
  assert.match(PONYTAIL_INSTRUCTIONS, /Fix root cause, not reported symptom/);
  assert.match(UNSLOP_INSTRUCTIONS, /Repo style and requested format win/);
  const tokens = estimateText(`${PONYTAIL_INSTRUCTIONS}\n\n${UNSLOP_INSTRUCTIONS}`);
  assert.ok(tokens <= 2_000, `policy estimate ${tokens} exceeds 2,000 tokens`);
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

test("CI and the human guide match runtime scope", () => {
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
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40} # v7\.0\.0/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40} # v7\.0\.0/);
  assert.match(workflow, /node-version: \$\{\{ matrix\.node \}\}/);
  assert.match(workflow, /schedule:\n    - cron: "17 9 \* \* 1"/);
  assert.match(workflow, /@earendil-works\/pi-coding-agent@latest @earendil-works\/pi-tui@latest typebox@latest/);
  assert.doesNotMatch(workflow, /@earendil-works\/pi-ai@latest/);
  assert.match(workflow, /typebox@latest/);
  assert.match(workflow, /if: matrix\.os == 'ubuntu-latest' && matrix\.node == '22\.19\.0' && matrix\.pi == 'pinned'\n\s+run: npm audit --audit-level=high/);
  assert.equal((workflow.match(/npm audit/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /npm audit --omit=dev/);
  assert.match(workflow, /- run: npm run check/);
  assert.doesNotMatch(workflow, /continue-on-error|--force|--omit=dev|test-name-pattern/);

  assert.ok(readme.trimEnd().split("\n").length < 80, "README must stay below 80 lines");
  for (const prompt of promptPaths) assert.match(readme, new RegExp(prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(readme, /\]\(policies\/unslop\.md\)/);
  assert.match(readme, /do not control filesystem, shell, network, Git, or provider access/);
  assert.match(readme, /replacing dirty in-scope docs without confirmation/);
  assert.match(readme, /merges green PRs without confirmation/);
  assert.match(readme, /isolated offline Pi state/);
  assert.match(readme, /2,000 UTF-8 bytes and 400 lines/);
  assert.match(readme, /metadata estimate is at most 400 tokens/);
  assert.match(readme, /at most 2,000 tokens/);
  assert.match(readme, /prompt expansions combine to at most 775 tokens/);
  for (const notice of ["caveman.LICENSE", "ponytail.LICENSE", "unslop.LICENSE"]) assert.match(readme, new RegExp(notice.replace(".", "\\.")));
  for (const source of ["DietrichGebert/ponytail", "JuliusBrussee/caveman", "cursor/plugins"]) assert.match(readme, new RegExp(source));
  for (const command of promptNames) assert.match(readme, new RegExp(`/${command}(?:\\s|\\[|\\x60)`));
});

test("sensitive Pi state and session transcripts are ignored", () => {
  const patterns = new Set(gitignore.split("\n"));
  for (const pattern of [".pi/", "sessions/", "*.jsonl", "settings.json", "models.json", "trust.json"]) {
    assert.ok(patterns.has(pattern), pattern);
  }
});
