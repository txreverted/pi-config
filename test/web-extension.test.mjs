import test from "node:test";
import assert from "node:assert/strict";
import webExtension, { formatSearchResults } from "../extensions/web.ts";

function loadTools() {
  const tools = new Map();
  webExtension({ registerTool(tool) { tools.set(tool.name, tool); } });
  return tools;
}

test("extension registers only keyless web search", () => {
  const tools = loadTools();
  assert.deepEqual([...tools.keys()], ["web_search"]);
  assert.match(tools.get("web_search").description, /Every query is sent to Exa.*may also be sent.*DuckDuckGo/);
});

test("web search details report every attempted provider", async () => {
  const tools = loadTools();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response("unavailable", { status: 503 });
    return new Response(`<div class="result"><a class="result__a" href="https://example.com/">Example</a></div>`, { status: 200 });
  };
  try {
    const result = await tools.get("web_search").execute("search", { query: "provider routing", limit: 1 });
    assert.equal(result.details.provider, "duckduckgo");
    assert.deepEqual(result.details.attemptedProviders, ["exa-mcp", "duckduckgo"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web search reserves its truncation notice within the output cap", () => {
  const search = formatSearchResults("max output", {
    provider: "exa-mcp",
    attemptedProviders: ["exa-mcp"],
    results: Array.from({ length: 10 }, (_, index) => ({
      title: `${index}${"t".repeat(299)}`,
      url: `https://example.com/${"u".repeat(4_076)}`,
      snippet: "s".repeat(1_000),
    })),
  });
  assert.ok(Buffer.byteLength(search, "utf8") <= 50 * 1024);
  assert.match(search, /\[Output truncated at 50KB\.\]$/);
});

test("web result formatting removes terminal controls from untrusted data", () => {
  const search = formatSearchResults("query\u202e", {
    provider: "duckduckgo",
    attemptedProviders: ["exa-mcp", "duckduckgo"],
    results: [{
      title: "Title\u001b]52;c;SGFja2Vk\u0007",
      url: "https://example.com/\u202e",
      snippet: "snippet\u001b[31m",
    }],
  });

  assert.doesNotMatch(search, /[\u001b\u0007\u202e]/);
  assert.match(search, /https:\/\/example\.com\//);
});
