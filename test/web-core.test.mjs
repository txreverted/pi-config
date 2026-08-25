import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { createFirecrawlClient } from "../extensions/web-core.ts";

const jsonResponse = (body, init = {}) => new Response(JSON.stringify(body), {
  status: init.status ?? 200,
  headers: { "content-type": "application/json", ...init.headers },
});

const searchPayload = {
  success: true,
  data: {
    web: [{
      title: "Firecrawl docs",
      url: "https://docs.firecrawl.dev/features/search",
      description: "Relevant passage",
      category: "developer",
      position: 1,
    }],
  },
  id: "search-job",
  creditsUsed: 2,
};

test("web search sends bounded Firecrawl v2 parameters and formats cited results", async () => {
  let request;
  const client = createFirecrawlClient({
    getApiKey: () => "fc-test-secret",
    fetcher: async (url, init) => {
      request = { url, init };
      return jsonResponse(searchPayload);
    },
  });
  const result = await client.search({
    query: "  Firecrawl\u001b[31m search  ",
    limit: 3,
    recency: "week",
    category: "developer",
    includeDomains: ["DOCS.FIRECRAWL.DEV", "docs.firecrawl.dev"],
  });

  assert.equal(request.url, "https://api.firecrawl.dev/v2/search");
  assert.equal(request.init.headers.authorization, "Bearer fc-test-secret");
  assert.deepEqual(JSON.parse(request.init.body), {
    query: "Firecrawl search",
    limit: 3,
    safe: true,
    highlights: true,
    ignoreInvalidURLs: true,
    timeout: 30000,
    tbs: "qdr:w",
    categories: ["developer"],
    includeDomains: ["docs.firecrawl.dev"],
  });
  assert.match(result.text, /External web search results/);
  assert.match(result.text, /Title: Firecrawl docs/);
  assert.match(result.text, /URL: https:\/\/docs\.firecrawl\.dev\/features\/search/);
  assert.doesNotMatch(result.text, /\u001b/);
  assert.deepEqual(result.details, {
    query: "Firecrawl search",
    resultCount: 1,
    results: [{ title: "Firecrawl docs", url: "https://docs.firecrawl.dev/features/search" }],
    jobId: "search-job",
    creditsUsed: 2,
    warning: undefined,
    truncation: undefined,
    fullOutputPath: undefined,
  });
});

test("web search validates filters before making a request", async () => {
  let calls = 0;
  const client = createFirecrawlClient({ fetcher: async () => { calls++; return jsonResponse(searchPayload); } });
  await assert.rejects(() => client.search({
    query: "test",
    includeDomains: ["example.com"],
    excludeDomains: ["other.example"],
  }), /cannot be used together/);
  await assert.rejects(() => client.search({ query: "test", includeDomains: ["https:\/\/example.com"] }), /Invalid search domain/);
  await assert.rejects(() => client.search({ query: "test", limit: 11 }), /limit must be 1-10/);
  assert.equal(calls, 0);
});

test("Firecrawl retries documented statuses, honors Retry-After, and omits absent authentication", async () => {
  let calls = 0;
  const delays = [];
  const client = createFirecrawlClient({
    getApiKey: () => undefined,
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    fetcher: async (_url, init) => {
      calls++;
      assert.equal(init.headers.authorization, undefined);
      return calls === 1
        ? jsonResponse({ success: false, error: "busy" }, { status: 429, headers: { "retry-after": "0.25" } })
        : jsonResponse(searchPayload);
    },
  });
  const result = await client.search({ query: "retry" });
  assert.equal(result.details.resultCount, 1);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);
});

test("Firecrawl errors are actionable and redact the API key", async () => {
  const secret = "fc-do-not-print";
  const denied = createFirecrawlClient({
    getApiKey: () => undefined,
    fetcher: async () => jsonResponse({ success: false, error: "suspicious IP" }, { status: 403 }),
  });
  await assert.rejects(() => denied.search({ query: "test" }), /Set FIRECRAWL_API_KEY/);

  const failed = createFirecrawlClient({
    getApiKey: () => secret,
    fetcher: async () => jsonResponse({ success: false, error: `server echoed ${secret}` }, { status: 500 }),
    sleep: async () => {},
  });
  await assert.rejects(() => failed.search({ query: "test" }), (error) => {
    assert.doesNotMatch(error.message, new RegExp(secret));
    assert.match(error.message, /\[REDACTED\]/);
    return true;
  });
});

test("web requests honor Pi cancellation", async () => {
  const controller = new AbortController();
  const client = createFirecrawlClient({
    fetcher: async (_url, init) => await new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      controller.abort();
    }),
  });
  await assert.rejects(() => client.search({ query: "cancel" }, controller.signal), /cancelled/);
});

test("web fetch requests Markdown, supports freshness, sanitizes content, and truncates safely", async () => {
  let body;
  const markdown = `# Page\n\nunsafe\u001b]0;title\u0007\n${"x".repeat(60_000)}`;
  const client = createFirecrawlClient({
    fetcher: async (_url, init) => {
      body = JSON.parse(init.body);
      return jsonResponse({
        success: true,
        data: {
          markdown,
          metadata: {
            title: "Example\u202e title",
            sourceURL: "https://example.com/start",
            url: "https://example.com/final",
            statusCode: 200,
          },
        },
      });
    },
  });
  const result = await client.fetchPage({ url: "https://example.com/start", fresh: true });

  assert.deepEqual(body, {
    url: "https://example.com/start",
    formats: ["markdown"],
    onlyMainContent: true,
    removeBase64Images: true,
    blockAds: true,
    timeout: 60000,
    maxAge: 0,
  });
  assert.match(result.text, /Title: Example title/);
  assert.match(result.text, /Full output saved to:/);
  assert.doesNotMatch(result.text, /[\u001b\u0007\u202e]/);
  assert.ok(Buffer.byteLength(result.text, "utf8") <= DEFAULT_MAX_BYTES);
  assert.ok(result.text.split("\n").length <= DEFAULT_MAX_LINES);
  assert.equal(result.details.url, "https://example.com/final");
  assert.equal(result.details.sourceUrl, "https://example.com/start");
  assert.equal(result.details.truncation.truncated, true);
  assert.match(await readFile(result.details.fullOutputPath, "utf8"), /x{100}/);
  await rm(dirname(result.details.fullOutputPath), { recursive: true, force: true });
});

test("web fetch rejects unsafe URLs and invalid Firecrawl responses", async () => {
  let calls = 0;
  const client = createFirecrawlClient({ fetcher: async () => { calls++; return jsonResponse({ success: true, data: {} }); } });
  await assert.rejects(() => client.fetchPage({ url: "file:///etc/passwd" }), /HTTP or HTTPS/);
  await assert.rejects(() => client.fetchPage({ url: "https://user:pass@example.com" }), /without credentials/);
  assert.equal(calls, 0);
  await assert.rejects(() => client.fetchPage({ url: "https://example.com" }), /no page content/);
});

test("Firecrawl response bodies have a hard safety limit", async () => {
  const client = createFirecrawlClient({
    fetcher: async () => new Response("{}", { headers: { "content-length": String(11 * 1024 * 1024) } }),
  });
  await assert.rejects(() => client.search({ query: "large" }), /10\.0MB safety limit/);
});
