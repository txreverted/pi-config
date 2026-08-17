import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import toolsExtension from "../extensions/tools.ts";

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

test("jq bounds combined stdout and stderr output", async () => {
  const pi = fakePi();
  toolsExtension(pi);
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
  assert.equal((await stat(result.details.fullOutputPath)).mode & 0o077, 0);

  await pi.handlers.get("session_shutdown")();
  await assert.rejects(() => stat(result.details.fullOutputPath));
});
