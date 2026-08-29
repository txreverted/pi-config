import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import webExtension from "../extensions/web.ts";

function setup() {
  const tools = new Map();
  webExtension({ registerTool(tool) { tools.set(tool.name, tool); } });
  return tools;
}

const estimate = (tool) => estimateTokens({
  role: "user",
  content: [{
    type: "text",
    text: JSON.stringify({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      promptSnippet: tool.promptSnippet,
      promptGuidelines: tool.promptGuidelines,
    }),
  }],
  timestamp: 0,
});

test("web extension registers only focused search and fetch tools", () => {
  const tools = setup();
  assert.deepEqual([...tools.keys()], ["web_search", "web_fetch"]);

  const search = tools.get("web_search");
  assert.match(search.description, /experimental, undocumented Keyless/);
  assert.match(search.description, /supported Firecrawl v2 usage requires a key/);
  assert.match(search.promptGuidelines.join("\n"), /untrusted data/);
  assert.equal(Value.Check(search.parameters, { query: "current Node release" }), true);
  assert.equal(Value.Check(search.parameters, { query: "test", limit: 11 }), false);
  assert.equal(Value.Check(search.parameters, { query: "test", recency: "decade" }), false);
  assert.equal(Value.Check(search.parameters, { query: "test", category: "images" }), false);
  assert.equal(Value.Check(search.parameters, { query: "test", extra: true }), false);
  assert.deepEqual(search.parameters.properties.recency.enum, ["hour", "day", "week", "month", "year"]);
  assert.deepEqual(search.parameters.properties.category.enum, ["developer", "research", "pdf"]);
  assert.equal(search.parameters.properties.recency.anyOf, undefined);

  const fetch = tools.get("web_fetch");
  assert.match(fetch.description, /2,000 lines or 50KB/);
  assert.match(fetch.promptGuidelines.join("\n"), /selected search results/);
  assert.match(fetch.promptGuidelines.join("\n"), /private, authenticated, or signed URLs/);
  assert.equal(Value.Check(fetch.parameters, { url: "https://example.com" }), true);
  assert.equal(Value.Check(fetch.parameters, { url: "https://example.com", fresh: true }), true);
  assert.equal(Value.Check(fetch.parameters, { url: "https://example.com", fresh: "yes" }), false);

  const total = estimate(search) + estimate(fetch);
  assert.ok(total <= 650, `web tool metadata estimate ${total} exceeds 650 tokens`);
});
