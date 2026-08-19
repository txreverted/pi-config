import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDuckDuckGoHtml,
  parseExaSearchText,
  searchExa,
  searchWeb,
} from "../extensions/web-core.ts";

test("oversized search responses cancel their bodies", async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    cancel() { cancelled = true; },
  }), {
    status: 200,
    headers: { "content-length": String(3 * 1024 * 1024) },
  });
  try {
    await assert.rejects(() => searchExa("bounded"), /exceeds 2MB limit/);
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chunked oversized search responses are cancelled", async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  }), { status: 200 });
  try {
    await assert.rejects(() => searchExa("bounded"), /exceeds 2MB limit/);
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Exa MCP parsing accepts multiline SSE data", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`data: {"result":
data: {"content":[{"type":"text","text":"Title: SSE result\\nURL: https://example.com/sse\\nText: Parsed"}]}}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  try {
    assert.deepEqual((await searchExa("sse", 1)).results, [{
      title: "SSE result",
      url: "https://example.com/sse",
      snippet: "Parsed",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web search cancellation does not start its fallback provider", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    controller.abort(new Error("cancelled by test"));
    throw options.signal.reason;
  };
  try {
    await assert.rejects(() => searchWeb("cancel", 1, controller.signal), /cancelled by test/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Exa text results are parsed, deduplicated, and restricted to HTTP URLs", () => {
  const parsed = parseExaSearchText(`Title: First result
URL: https://example.com/a
Text: Useful first snippet.
---
Title: Duplicate
URL: https://example.com/a
Text: Duplicate snippet.
---
Title: Unsafe
URL: javascript:alert(1)
Text: Ignore.
---
Title: Second result
URL: https://example.org/b
Highlights:
Useful second snippet.
---`, 5);

  assert.deepEqual(parsed.results, [
    { title: "First result", url: "https://example.com/a", snippet: "Useful first snippet." },
    { title: "Second result", url: "https://example.org/b", snippet: "Useful second snippet." },
  ]);
});

test("Exa JSON results are parsed and oversized normalized URLs are rejected", () => {
  const parsed = parseExaSearchText(JSON.stringify({
    results: [
      { title: "JSON result", url: "https://example.net/", highlights: ["One", "two"] },
      { title: "Too long", url: `https://example.com/${"x".repeat(4_096)}` },
    ],
  }));
  assert.deepEqual(parsed.results, [
    { title: "JSON result", url: "https://example.net/", snippet: "One two" },
  ]);
});

test("keyless search providers omit ambient credential headers", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (requests.length === 1) return new Response("unavailable", { status: 503 });
    return new Response(`<div class="result"><a class="result__a" href="https://example.com/">Result</a></div>`, { status: 200 });
  };
  try {
    await searchWeb("credential check", 1);
    assert.equal(requests.length, 2);
    for (const { options } of requests) {
      const headers = new Headers(options.headers);
      assert.equal(headers.has("authorization"), false);
      assert.equal(headers.has("cookie"), false);
      assert.equal(headers.has("proxy-authorization"), false);
      assert.equal(options.credentials, undefined);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web search falls back when Exa returns no parseable results", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return new Response(JSON.stringify({
        result: { content: [{ type: "text", text: "No parseable result URLs" }] },
      }), { status: 200 });
    }
    return new Response(`<div class="result">
      <a class="result__a" href="https://example.com/fallback">Fallback result</a>
    </div>`, { status: 200 });
  };
  try {
    const result = await searchWeb("fallback", 1);
    assert.equal(calls, 2);
    assert.equal(result.provider, "duckduckgo");
    assert.deepEqual(result.results, [{
      title: "Fallback result",
      url: "https://example.com/fallback",
      snippet: "",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web search falls back from Exa to DuckDuckGo and reports both failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response("unavailable", { status: 503 });
    return new Response(`<div class="result">
      <a class="result__a" href="https://example.com/fallback">Fallback result</a>
      <a class="result__snippet">Fallback snippet.</a>
    </div>`, { status: 200 });
  };
  try {
    const result = await searchWeb("fallback", 1);
    assert.equal(result.provider, "duckduckgo");
    assert.deepEqual(result.attemptedProviders, ["exa-mcp", "duckduckgo"]);
    assert.deepEqual(result.results, [{
      title: "Fallback result",
      url: "https://example.com/fallback",
      snippet: "Fallback snippet.",
    }]);

    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    await assert.rejects(
      () => searchWeb("failure", 1),
      /Keyless web search failed \(Exa: Exa search failed with HTTP 503; DuckDuckGo: DuckDuckGo search failed with HTTP 503\)/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DuckDuckGo HTML results and redirect URLs are parsed", () => {
  const html = `<div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example docs</a>
    <a class="result__snippet">A useful result.</a>
  </div>
  <div class="result result--ad">
    <a class="result__a" href="https://ads.example/">Advertisement</a>
  </div>`;
  assert.deepEqual(parseDuckDuckGoHtml(html).results, [
    { title: "Example docs", url: "https://example.com/docs", snippet: "A useful result." },
  ]);
});
