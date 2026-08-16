import test from "node:test";
import assert from "node:assert/strict";
import webExtension, {
  configuredProxy,
  formatFetchedContent,
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
