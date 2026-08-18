import assert from "node:assert/strict";
import webExtension from "../extensions/web.ts";

if (process.env.PI_LIVE_WEB !== "1") {
  console.log("Set PI_LIVE_WEB=1 to run external web checks.");
  process.exit(0);
}

const tools = new Map();
webExtension({ registerTool(tool) { tools.set(tool.name, tool); } });

const search = await tools.get("web_search").execute(
  "live-search",
  { query: "Example Domain IANA", limit: 3 },
  undefined,
  undefined,
);
assert.match(search.content[0].text, /https?:\/\//);
console.log("Live web search passed.");
