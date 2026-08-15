import test from "node:test";
import assert from "node:assert/strict";

process.env.PI_OFFLINE = "1";
const {
  default: toolsExtension,
  displayPath,
  parseNulRecords,
} = await import("../extensions/tools.ts");

function fakePi() {
  const tools = new Map();
  const handlers = new Map();
  let active = ["read", "grep", "find"];

  return {
    tools,
    handlers,
    get active() { return active; },
    registerTool(tool) {
      tools.set(tool.name, tool);
      if (!active.includes(tool.name)) active.push(tool.name);
    },
    on(event, handler) {
      handlers.set(event, handler);
    },
    getActiveTools() {
      return [...active];
    },
    setActiveTools(names) {
      active = [...names];
    },
  };
}

test("search tools override find and replace active grep with rg", async () => {
  const pi = fakePi();
  await toolsExtension(pi);

  assert.deepEqual([...pi.tools.keys()], ["jq", "find", "rg"]);
  assert.match(pi.tools.get("find").description, /overrides Pi's built-in find/);
  assert.match(pi.tools.get("rg").description, /replaces Pi's built-in grep/);

  await pi.handlers.get("session_start")();
  assert.equal(pi.active.includes("grep"), false);
  assert.equal(pi.active.includes("find"), true);
  assert.equal(pi.active.includes("rg"), true);
});

test("jq adapter executes shell-free input and enforces exclusive input modes", async () => {
  const pi = fakePi();
  await toolsExtension(pi);
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

test("find record parsing preserves legal whitespace and escapes embedded newlines", () => {
  const records = parseNulRecords(" trailing.ts \0split\nname.ts\0partial");
  assert.deepEqual(records, [" trailing.ts ", "split\nname.ts"]);
  assert.equal(displayPath(records[0]), " trailing.ts ");
  assert.equal(displayPath(records[1]), String.raw`split\nname.ts`);
});
