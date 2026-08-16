import assert from "node:assert/strict";
import webExtension, { configuredProxy } from "../extensions/web.ts";

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

if (configuredProxy()) {
  await assert.rejects(
    () => tools.get("web_fetch").execute("live-fetch", { url: "https://example.com", reader: "never" }),
    /disabled while an HTTP proxy is configured/,
  );
  console.log("Live web search passed; web_fetch correctly failed closed for the configured proxy.");
} else {
  const fetched = await tools.get("web_fetch").execute(
    "live-fetch",
    { url: "https://example.com", reader: "never" },
  );
  assert.match(fetched.content[0].text, /Example Domain/);
  console.log("Live web search and direct fetch passed.");
}
