import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import toolsExtension, { retainBoundedOutput, sanitizeRetainedOutput } from "../extensions/tools.ts";

function fakePi(initialActive = ["read", "grep", "find"]) {
  const tools = new Map();
  const handlers = new Map();
  let active = [...initialActive];
  return {
    tools,
    handlers,
    active: () => active,
    registerTool(tool) { tools.set(tool.name, tool); },
    on(event, handler) { handlers.set(event, handler); },
    getActiveTools() { return [...active]; },
    setActiveTools(names) { active = [...names]; },
  };
}

test("local tools register only jq and activate native search without overriding it", () => {
  const pi = fakePi();
  toolsExtension(pi);
  assert.deepEqual([...pi.tools.keys()], ["jq"]);
  pi.handlers.get("session_start")();
  assert.deepEqual(pi.active(), ["read", "grep", "find"]);

  const disabled = fakePi(["read"]);
  toolsExtension(disabled);
  disabled.handlers.get("session_start")();
  assert.deepEqual(disabled.active(), ["read", "grep", "find"]);
});

test("jq executes shell-free input and enforces exclusive input modes", async () => {
  const pi = fakePi();
  toolsExtension(pi);
  const jq = pi.tools.get("jq");
  assert.equal(jq.executionMode, "sequential");
  const result = await jq.execute("jq-test", {
    filter: ".items | add",
    input: JSON.stringify({ items: [2, 3] }),
  }, undefined, undefined, { cwd: process.cwd() });
  assert.equal(result.content[0].text.trim(), "5");
  await assert.rejects(
    () => jq.execute("jq-test", { filter: ".", input: "{}", files: ["package.json"] }, undefined, undefined, { cwd: process.cwd() }),
    /either input or files/,
  );
});

test("jq bounds aggregate variable input before spawning", async () => {
  const pi = fakePi();
  toolsExtension(pi);
  await assert.rejects(
    () => pi.tools.get("jq").execute("jq-bounds", {
      filter: ".",
      nullInput: true,
      variables: Array.from({ length: 17 }, (_, index) => ({ name: `v${index}`, value: "x".repeat(64 * 1024) })),
    }, undefined, undefined, { cwd: process.cwd() }),
    /variable values must total at most 1\.0MB/,
  );
});

test("jq enforces the portable aggregate argv boundary before spawning", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-jq-argv-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "data.json"), "{}");

  const fixedArgv = [
    "jq", "--raw-output", "--compact-output", "--slurp", "--sort-keys",
    "--arg", "v", "x", "--", "", "data.json",
  ];
  const fixedBytes = fixedArgv.reduce((total, value) => total + Buffer.byteLength(value, "utf8") + 2, 0);
  const filterBytes = 16 * 1024 - 1 - fixedBytes;
  const filter = `${" ".repeat(filterBytes - 1)}.`;
  const params = {
    filter,
    files: ["data.json"],
    variables: [{ name: "v", value: "x" }],
    rawOutput: true,
    compactOutput: true,
    slurp: true,
    sortKeys: true,
  };
  const pi = fakePi();
  toolsExtension(pi);

  const result = await pi.tools.get("jq").execute(
    "jq-argv-boundary", params, undefined, undefined, { cwd: root },
  );
  assert.equal(result.content[0].text.trim(), "[{}]");
  await assert.rejects(
    () => pi.tools.get("jq").execute(
      "jq-argv-overflow", { ...params, filter: `${filter} ` }, undefined, undefined, { cwd: join(root, "missing") },
    ),
    /command line must be less than 16\.0KB/,
  );
});

test("jq preserves leading-at filenames after the option terminator", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-jq-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "@data.json"), JSON.stringify({ name: "at-file" }));
  await writeFile(join(root, "data.json"), JSON.stringify({ name: "plain-file" }));
  const pi = fakePi();
  toolsExtension(pi);
  const result = await pi.tools.get("jq").execute("jq-path", {
    filter: ".name",
    files: ["@data.json"],
    rawOutput: true,
  }, undefined, undefined, { cwd: root });
  assert.equal(result.content[0].text.trim(), "at-file");
});

test("failed retained-output sanitation removes its temporary directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-jq-sanitize-"));
  const invalidOutput = join(root, "output.txt");
  await mkdir(invalidOutput);
  await assert.rejects(() => sanitizeRetainedOutput(invalidOutput));
  await assert.rejects(() => stat(root));
});

test("jq excludes parent secrets from its child environment", async () => {
  const previous = process.env.PI_CONFIG_JQ_SECRET;
  const previousLowerPath = process.env.path;
  process.env.PI_CONFIG_JQ_SECRET = "canary";
  if (process.platform !== "win32") process.env.path = "case-sensitive-canary";
  try {
    const pi = fakePi();
    toolsExtension(pi);
    const result = await pi.tools.get("jq").execute("jq-env", {
      filter: "$ENV.PI_CONFIG_JQ_SECRET // \"absent\"",
      nullInput: true,
      rawOutput: true,
    }, undefined, undefined, { cwd: process.cwd() });
    assert.equal(result.content[0].text.trim(), "absent");
    if (process.platform !== "win32") {
      const lowerPath = await pi.tools.get("jq").execute("jq-env-case", {
        filter: "$ENV.path // \"absent\"",
        nullInput: true,
        rawOutput: true,
      }, undefined, undefined, { cwd: process.cwd() });
      assert.equal(lowerPath.content[0].text.trim(), "absent");
    }
  } finally {
    if (previous === undefined) delete process.env.PI_CONFIG_JQ_SECRET;
    else process.env.PI_CONFIG_JQ_SECRET = previous;
    if (previousLowerPath === undefined) delete process.env.path;
    else process.env.path = previousLowerPath;
  }
});

test("jq bounds combined stdout and stderr output", async (t) => {
  const pi = fakePi();
  toolsExtension(pi);
  t.after(() => pi.handlers.get("session_shutdown")());
  const jq = pi.tools.get("jq");
  for (const filter of [
    "(\"x\" * 50000), (range(0; 3000) | debug | empty)",
    "range(0; 1500), (range(0; 3000) | debug | empty)",
  ]) {
    const result = await jq.execute("jq-combined", {
      filter,
      nullInput: true,
      rawOutput: true,
    }, undefined, undefined, { cwd: process.cwd() });
    assert.ok(Buffer.byteLength(result.content[0].text, "utf8") <= DEFAULT_MAX_BYTES);
    assert.ok(result.content[0].text.split("\n").length <= DEFAULT_MAX_LINES);
    assert.match(result.content[0].text, /Combined jq output truncated/);
  }
});

test("jq reports stderr-triggered combined output limits", async () => {
  const pi = fakePi();
  toolsExtension(pi);
  const result = await pi.tools.get("jq").execute("jq-stderr-limit", {
    filter: "range(0; 800000) | debug | empty",
    nullInput: true,
  }, undefined, undefined, { cwd: process.cwd() });

  assert.equal(result.details.outputLimitReached, 10 * 1024 * 1024);
  assert.equal(result.details.fullOutputPath, undefined);
  assert.match(result.content[0].text, /combined stdout\/stderr hard limit/);
});

test("retained jq output enforces its aggregate byte limit", async (t) => {
  const first = await mkdtemp(join(tmpdir(), "pi-jq-retain-first-"));
  const second = await mkdtemp(join(tmpdir(), "pi-jq-retain-second-"));
  t.after(() => Promise.all([first, second].map((path) => rm(path, { recursive: true, force: true }))));
  const firstPath = join(first, "output.txt");
  const secondPath = join(second, "output.txt");
  await writeFile(firstPath, "123456");
  await writeFile(secondPath, "123456");
  const retained = new Map();

  assert.equal(await retainBoundedOutput(retained, firstPath, 6, 10, 10), 0);
  assert.equal(await retainBoundedOutput(retained, secondPath, 6, 10, 10), 1);
  await assert.rejects(() => stat(firstPath));
  assert.equal((await stat(secondPath)).isFile(), true);
});

test("jq evicts oldest retained outputs at the session file limit", async (t) => {
  const pi = fakePi();
  toolsExtension(pi);
  t.after(() => pi.handlers.get("session_shutdown")());
  const paths = [];
  let latest;
  for (let index = 0; index < 11; index++) {
    latest = await pi.tools.get("jq").execute(`jq-retain-${index}`, {
      filter: "range(0; 2100)",
      nullInput: true,
      rawOutput: true,
    }, undefined, undefined, { cwd: process.cwd() });
    paths.push(latest.details.fullOutputPath);
  }

  await assert.rejects(() => stat(paths[0]));
  for (const path of paths.slice(1)) assert.equal((await stat(path)).isFile(), true);
  assert.equal(latest.details.evictedRetainedOutputs, 1);
  assert.match(latest.content[0].text, /Evicted 1 older retained jq output file/);
});

test("jq sanitizes terminal controls in displayed and retained output", async () => {
  const pi = fakePi();
  toolsExtension(pi);
  const result = await pi.tools.get("jq").execute("jq-safe", {
    filter: "range(0; 3000) | \"\\u001b]52;c;SGFja2Vk\\u0007safe\"",
    nullInput: true,
    rawOutput: true,
  }, undefined, undefined, { cwd: process.cwd() });

  assert.doesNotMatch(result.content[0].text, /[\u001b\u0007]/);
  assert.match(result.content[0].text, /safe/);
  assert.ok(result.details.fullOutputPath);
  assert.doesNotMatch(await readFile(result.details.fullOutputPath, "utf8"), /[\u001b\u0007]/);
  if (process.platform !== "win32") assert.equal((await stat(result.details.fullOutputPath)).mode & 0o077, 0);

  await pi.handlers.get("session_shutdown")();
  await assert.rejects(() => stat(result.details.fullOutputPath));
});
