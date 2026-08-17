import test from "node:test";
import assert from "node:assert/strict";
import webExtension, {
  configuredProxy,
  formatFetchedContent,
  formatFetchedPage,
  formatSearchResults,
} from "../extensions/web.ts";

test("proxy detection covers Pi and conventional environment spellings", () => {
  assert.equal(configuredProxy({}), false);
  assert.equal(configuredProxy({ HTTPS_PROXY: "http://proxy.invalid" }), true);
  assert.equal(configuredProxy({ http_proxy: " http://proxy.invalid " }), true);
  assert.equal(configuredProxy({ HTTP_PROXY: "  " }), false);
});

test("web_fetch rejects a configured proxy before network access while search stays registered", async () => {
  const tools = new Map();
  webExtension({ registerTool(tool) { tools.set(tool.name, tool); } });
  assert.deepEqual([...tools.keys()], ["web_search", "web_fetch"]);
  assert.match(tools.get("web_search").description, /Every query is sent to Exa.*may also be sent.*DuckDuckGo/);

  const previous = process.env.HTTPS_PROXY;
  process.env.HTTPS_PROXY = "http://127.0.0.1:9";
  try {
    await assert.rejects(
      () => tools.get("web_fetch").execute("fetch", { url: "https://example.com" }),
      /disabled while an HTTP proxy is configured/,
    );
  } finally {
    if (previous === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = previous;
  }
});

test("web search details report every attempted provider", async () => {
  const tools = new Map();
  webExtension({ registerTool(tool) { tools.set(tool.name, tool); } });
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

test("complete web outputs reserve notices within their byte caps", () => {
  const search = formatSearchResults("max output", {
    provider: "exa-mcp",
    results: Array.from({ length: 10 }, (_, index) => ({
      title: `${index}${"t".repeat(299)}`,
      url: `https://example.com/${"u".repeat(4_076)}`,
      snippet: "s".repeat(1_000),
    })),
  });
  assert.ok(Buffer.byteLength(search, "utf8") <= 50 * 1024);
  assert.match(search, /\[Output truncated at 50KB\.\]$/);

  const title = "t".repeat(500);
  const url = `https://example.com/${"u".repeat(4_076)}`;
  const fetched = formatFetchedPage({
    title,
    url,
    source: "direct",
    content: "😀".repeat(30_000),
  }, 0, 30_000);
  assert.ok(Buffer.byteLength(fetched.text, "utf8") <= 40 * 1024);
  assert.match(fetched.text, new RegExp(`Title: ${title}`));
  assert.match(fetched.text, new RegExp(`URL: ${url}`));
  assert.match(fetched.text, new RegExp(`\\[Content truncated\\. Call web_fetch again with start: ${fetched.end} to continue\\.\\]$`));

  const manyLines = formatFetchedPage({
    title: "Lines",
    url: "https://example.com/lines",
    source: "direct",
    content: "line\n".repeat(10_000),
  }, 0, 30_000);
  assert.ok(manyLines.text.split("\n").length <= 2_000);
  assert.equal(manyLines.truncated, true);
  assert.match(manyLines.text, /Content truncated/);

  const emptyPage = { title: "Empty", url: "https://example.com/empty", source: "direct", content: "" };
  assert.doesNotThrow(() => formatFetchedPage(emptyPage, 0, 1_000));
  assert.throws(() => formatFetchedPage(emptyPage, 1, 1_000), /beyond content length 0/);
});

test("web result formatting removes terminal controls from untrusted data", () => {
  const search = formatSearchResults("query\u202e", {
    provider: "duckduckgo",
    results: [{
      title: "Title\u001b]52;c;SGFja2Vk\u0007",
      url: "https://example.com/\u202e",
      snippet: "snippet\u001b[31m",
    }],
  });
  const fetched = formatFetchedContent({
    title: "Title\u001b]0;changed\u0007",
    url: "https://example.com/\u202e",
    source: "direct",
  }, "safe\u001b]52;c;SGFja2Vk\u0007\ncontent").join("\n");

  for (const value of [search, fetched]) {
    assert.doesNotMatch(value, /[\u001b\u0007\u202e]/);
    assert.match(value, /https:\/\/example\.com\//);
  }
  assert.match(fetched, /safe\ncontent/);
});
