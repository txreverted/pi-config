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

test("find record parsing preserves legal whitespace and escapes embedded newlines", () => {
  const records = parseNulRecords(" trailing.ts \0split\nname.ts\0partial");
  assert.deepEqual(records, [" trailing.ts ", "split\nname.ts"]);
  assert.equal(displayPath(records[0]), " trailing.ts ");
  assert.equal(displayPath(records[1]), String.raw`split\nname.ts`);
});
