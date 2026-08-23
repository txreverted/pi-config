import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DefaultResourceLoader, estimateTokens } from "@earendil-works/pi-coding-agent";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const normalizeLines = (text) => text.replace(/\r\n?/g, "\n");
const gitignore = normalizeLines(await readFile(new URL("../.gitignore", import.meta.url), "utf8"));
const readme = normalizeLines(await readFile(new URL("../README.md", import.meta.url), "utf8"));
const workflow = normalizeLines(await readFile(new URL("../.github/workflows/check.yml", import.meta.url), "utf8"));
const smoke = normalizeLines(await readFile(new URL("./smoke.mjs", import.meta.url), "utf8"));
const fastSource = normalizeLines(await readFile(new URL("../extensions/fast.ts", import.meta.url), "utf8"));
const subagentsSource = normalizeLines(await readFile(new URL("../extensions/subagents.ts", import.meta.url), "utf8"));
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
  "./extensions/subagents.ts",
  "./extensions/fast.ts",
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
      { name: "r-docs", description: "Rebuild and replace documentation, including dirty files", argumentHint: "[scope]" },
      { name: "r-git", description: "Split dirty work into checked PRs and merge them", argumentHint: undefined },
      { name: "r-impl", description: "Audit core behavior and implementation size", argumentHint: "[scope]" },
    ]);

    const piDist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
    const { expandPromptTemplate } = await import(pathToFileURL(join(piDist, "core", "prompt-templates.js")).href);
    const docs = expandPromptTemplate("/r-docs", loaded.prompts);
    assertClauses(docs, [
      /Scope: entire repository\./,
      /Rebuild repo documentation from scratch now\./,
      /Obey applicable `AGENTS\.md` files/,
      /tracked, untracked and dirty `\.md` paths/,
      /claims, wording, structure, links, and examples are not evidence/,
      /instructions, runtime prompts\/policies, generated\/frozen files, licenses\/notices, ignored or vendored content, and unrelated changes/,
      /Inspect code\/config\/tests, dependency contracts, and safe command output/,
      /Keep the smallest useful set and root `README\.md`/,
      /Add a human doc only for a separate task that would burden README/,
      /Do not keep a path merely because it existed/,
      /Draft every replacement before writing\/deleting/,
      /Show dirty in-scope human docs to replace/,
      /Invocation authorizes replacement; do not ask for confirmation/,
      /delete only obsolete human docs/,
      /Start README with a title and one to three exact sentences/,
      /Link required instructions near top/,
      /shortest safe setup\/run\/canonical-check commands/,
      /code map only when useful/,
      /limits and side effects beside behavior/,
      /Prefer bullets and under 80 lines/,
      /use tables only for comparisons/,
      /Omit inventories; dependency\/version tables; test counts; CI detail; implementation narration/,
      /Link source\/tests instead of copying detail/,
      /No placeholders/,
      /Change no non-Markdown files/,
      /Run only repository-required checks or a documented Markdown check/,
      /Never run paid calls, deploys, migrations, pushes, publishes, or live operations/,
      /Verify every claim, command, path, and link against non-doc evidence/,
      /Report deleted, created, and updated docs plus unresolved doc\/code mismatches/,
      /Omit unchanged files/,
    ]);
    assert.doesNotMatch(docs, /Delete every human documentation file in scope before drafting/);
    assert.match(expandPromptTemplate('/r-docs "docs and examples"', loaded.prompts), /Scope: docs and examples\./);

    const implementation = expandPromptTemplate("/r-impl", loaded.prompts);
    assertClauses(implementation, [
      /Scope: entire repository\./,
      /main features meet explicit requirements with the least code/,
      /Prefer "no change needed\."/,
      /Do not modify files unless explicitly asked/,
      /Derive supported behavior from code, config, tests, and repository rules/,
      /assumptions are not requirements/,
      /caller, input, state change, output, and important failure/,
      /Check ownership; prefer one root-cause fix or deletion over local patches/,
      /bugs breaking a main feature or explicit requirement/,
      /reachable data loss or security flaws at a real trust boundary/,
      /existing complexity removable now without changing required behavior/,
      /missing focused tests for non-trivial core behavior or a reported regression/,
      /Exclude theoretical hardening, unmeasured performance work, speculative scale/,
      /Performance requires user-visible harm/,
      /security requires a reachable path and concrete impact/,
      /exact file and symbol or line/,
      /observed behavior and evidence/,
      /impact on a main feature or requirement/,
      /smallest fix, preferably deletion or reuse/,
      /one focused check/,
      /Keep cleanup separate from bugs/,
      /No category scores or invented findings/,
      /If no small fix is justified, say no change is needed/,
    ]);
    assert.match(expandPromptTemplate("/r-impl extensions tests", loaded.prompts), /Scope: extensions tests\./);
    assert.doesNotMatch(implementation, /Score each category|Severity: critical|Correctness: 3|Tests: 1/);

    const git = expandPromptTemplate("/r-git", loaded.prompts);
    assertClauses(git, [
      /^Read repo\/Git rules/,
      /Split staged\/unstaged\/untracked work into smallest coherent PRs; order dependencies/,
      /Screen names first/,
      /stop on ignored\/unclear paths, credentials\/private keys, auth\/settings, sessions\/transcripts, or content secrets/,
      /For each PR, merge dependencies; refresh\/verify default; branch/,
      /Commit only that group with tests\/docs/,
      /Run required checks; fix/,
      /await required CI\/reviews; fix\/merge/,
      /No confirmation/,
      /Preserve work/,
      /Never commit blocked files or stash\/reset\/discard\/overwrite\/force-push\/bypass checks\/CI\/hooks\/conflicts\/reviews\/protection/,
      /Stop on unsafe switch\/separation, failed access\/approval/,
      /Report merged PRs\/blockers/,
    ]);
    assert.doesNotMatch(git, /Run no local checks|ask for confirmation|bypass required/i);

    const promptTokens = {
      "r-docs": estimateText(docs),
      "r-git": estimateText(git),
      "r-impl": estimateText(implementation),
    };
    const ceilings = { "r-docs": 525, "r-git": 170, "r-impl": 380 };
    for (const name of promptNames) {
      assert.ok(promptTokens[name] <= ceilings[name], `${name} estimate ${promptTokens[name]} exceeds ${ceilings[name]}`);
    }
    const total = Object.values(promptTokens).reduce((sum, tokens) => sum + tokens, 0);
    assert.ok(total <= 1_075, `prompt estimate ${total} exceeds 1075 tokens`);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("fixed policies remain extensions and carry their notices", async () => {
  const policy = normalizeLines(await readFile(new URL("../policies/unslop.md", import.meta.url), "utf8"));
  assert.match(policy, /^Keep meaning\/tone/);
  assert.doesNotMatch(policy, /^---\n/);
  assert.equal(packageJson.pi.skills, undefined);
  assert.deepEqual((await readdir(new URL("../policies/", import.meta.url))).sort(), [
    "caveman.LICENSE",
    "ponytail.LICENSE",
    "unslop.LICENSE",
    "unslop.md",
  ]);
});

test("extension source uses only approved special UI glyphs", async () => {
  const approved = new Set(Array.from("□■☒○●✓!✗⊘⎿├─│└〉·…"));
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
      "extensions/fast-core.ts",
      "extensions/subagents-core.ts",
      "extensions/subagents-guard.ts",
      "extensions/subagents-pool.ts",
      "extensions/subagents-ui.ts",
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
    for (const target of relativeMarkdownTargets(readme)) {
      assert.ok(names.has(target), `README relative link is not packed: ${target}`);
    }
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test("production tarball installs without dev dependencies and loads through Pi", async () => {
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
    const tarball = join(temporary, JSON.parse(packed.stdout)[0].filename);
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
    const loaded = spawnSync(executable("pi"), ["-e", packagePath, "--list-models", "__pi_config_production_install__"], {
      cwd: application,
      encoding: "utf8",
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: join(piState, "agent"),
        PI_CODING_AGENT_SESSION_DIR: join(piState, "sessions"),
        PI_OFFLINE: "1",
      },
      timeout: 30_000,
      shell: process.platform === "win32",
    });
    assert.equal(loaded.status, 0, loaded.stderr || loaded.stdout);
    assert.match(loaded.stdout, /No models (?:matching|available)/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("CI, smoke isolation, and the human guide match runtime scope", async () => {
  assert.match(workflow, /^on:\n  push:\n  pull_request:/m);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40} # v7\.0\.0/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40} # v7\.0\.0/);
  assert.match(workflow, /node: \["22\.19\.0", "22\.x"\]/);
  assert.match(workflow, /node-version: \$\{\{ matrix\.node \}\}/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /schedule:\n    - cron: "17 9 \* \* 1"/);
  assert.match(workflow, /typebox@latest/);
  assert.match(workflow, /if: matrix\.os == 'ubuntu-latest' && matrix\.node == '22\.19\.0' && matrix\.pi == 'pinned'\n\s+run: npm audit --audit-level=high/);
  assert.equal((workflow.match(/npm audit/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /npm audit --omit=dev/);
  assert.match(workflow, /- run: npm run check/);
  assert.doesNotMatch(workflow, /test:windows/);
  assert.equal(packageJson.scripts["test:live-subagent"], undefined);
  assert.equal(
    packageJson.scripts["bench:subagents:live"],
    "node --experimental-strip-types test/live-subagents.mjs",
  );
  assert.doesNotMatch(workflow, /bench:subagents:live|PI_LIVE_SUBAGENTS|PI_LIVE_MODEL/);
  assert.doesNotMatch(workflow, /runner\.os != 'Windows'|test-name-pattern/);
  assert.doesNotMatch(workflow, /curl|Install fd|live-web|PI_LIVE_WEB/);
  assert.match(smoke, /PI_CODING_AGENT_DIR/);
  assert.match(smoke, /PI_CODING_AGENT_SESSION_DIR/);
  assert.match(smoke, /PI_OFFLINE/);
  assert.doesNotMatch(fastSource, /before_provider_request/);
  assert.doesNotMatch(fastSource, /setStatus/);
  assert.doesNotMatch(subagentsSource, /node:child_process|\bspawn\(|\.pi\/agents|agentScope/);
  assert.doesNotMatch(subagentsSource, /pi\.on\("agent_end"/);
  assert.doesNotMatch(subagentsSource, /tool_execution_end/);
  assert.doesNotMatch(subagentsSource, /from "\.\/fast\.ts"/);
  assert.doesNotMatch(fastSource, /parallel_scouts|registerCommand\("r-fast"|createAgentSession/);
  assert.doesNotMatch(subagentsSource, /registerCommand\("fast"|FooterComponent|setFooter/);

  for (const path of [...promptPaths, ...policyPaths]) await access(new URL(`../${path}`, import.meta.url));
  assert.ok(readme.trimEnd().split("\n").length < 80, "README must stay below 80 lines");
  for (const prompt of promptPaths) assert.match(readme, new RegExp(prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(readme, /\]\(policies\/unslop\.md\)/);
  assert.doesNotMatch(readme, /\/skill:unslop|hidden from automatic model invocation/);
  assert.match(readme, /do not control filesystem, shell, network, Git, or provider access/);
  assert.match(readme, /replacing dirty in-scope docs without confirmation/);
  assert.match(readme, /merges green PRs without confirmation/);
  assert.match(readme, /isolated offline Pi state/);
  assert.match(readme, /2,000 UTF-8 bytes and 400 lines/);
  assert.match(readme, /at most 500 tokens/);
  assert.match(readme, /does not include the Caveman proxy or Engine/);
  for (const notice of ["ponytail.LICENSE", "unslop.LICENSE", "caveman.LICENSE"]) assert.match(readme, new RegExp(notice.replace(".", "\\.")));
  for (const source of ["DietrichGebert/ponytail", "JuliusBrussee/caveman", "cursor/plugins"]) assert.match(readme, new RegExp(source));
  for (const command of promptNames) assert.match(readme, new RegExp(`/${command}(?:\\s|\\[|\\x60)`));
  assert.match(readme, /\[`\/r-fast <task>`\]\(extensions\/subagents\.ts\)/);
  assert.match(readme, /\[`\/fast`\]\(extensions\/fast\.ts\)/);
  assert.match(readme, /Run it once to enable fast mode and again to disable it/);
  assert.match(readme, /`fast` appears beside the model and thinking level in the footer/);
  assert.doesNotMatch(readme, /\/fast \[on\|off\|status\]/);
  assert.match(readme, /priority tier applies to the main agent and `\/r-fast` scouts/);
  assert.match(readme, /Fast mode uses higher provider pricing/);
  assert.match(readme, /delegates two to ten natural read-only investigations only when parallel work should beat direct work/);
  assert.match(readme, /at most four scouts active/);
  assert.match(readme, /Scout thinking targets `survey` low, `trace` medium, and `audit` high without exceeding the parent/);
  assert.match(readme, /parent alone decides, edits, tests, synthesizes, and uses Git/);
  assert.match(readme, /up to ten additional provider runs in four concurrent slots/);
  assert.match(readme, /guarded repository read\/search tools, but they are not an OS sandbox/);
  assert.match(readme, /bench:subagents:live/);
  assert.match(readme, /never part of `npm run check` or CI/);
  assert.doesNotMatch(readme, /## Current state|\| Policy size \||\| Pi checks \|/);
  assert.doesNotMatch(readme, /parallel_agents|agent_patch|PI_LIVE_SUBAGENT|project agents|recursive delegation/i);
  assert.doesNotMatch(readme, /web_search|web_fetch|PI_LIVE_WEB|\bExa\b|\bDuckDuckGo\b|--fast|service_tier|themes\//i);
});

test("the paid subagent benchmark refuses to run without both explicit gates", () => {
  const env = { ...process.env };
  delete env.PI_LIVE_SUBAGENTS;
  delete env.PI_LIVE_MODEL;
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    fileURLToPath(new URL("./live-subagents.mjs", import.meta.url)),
  ], { encoding: "utf8", env, timeout: 10_000 });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /Refusing paid benchmark: set PI_LIVE_SUBAGENTS=1/);
});

test("sensitive Pi state and session transcripts are ignored", () => {
  const patterns = new Set(gitignore.split("\n"));
  for (const pattern of [".pi/", "sessions/", "*.jsonl", "settings.json", "models.json", "trust.json"]) {
    assert.ok(patterns.has(pattern), pattern);
  }
});
