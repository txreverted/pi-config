import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
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
      category: "research",
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
    category: "research",
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
    categories: ["research"],
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

test("web search returns no more valid results than requested", async () => {
  const client = createFirecrawlClient({
    fetcher: async () => jsonResponse({
      success: true,
      data: {
        web: [
          { title: "Invalid", url: "file:///private", description: "skip" },
          { title: "One", url: "https://one.example.com", description: "first" },
          { title: "Two", url: "https://two.example.com", description: "second" },
          { title: "Three", url: "https://three.example.com", description: "must not appear" },
        ],
      },
    }),
  });

  const result = await client.search({ query: "bounded", limit: 2 });
  assert.equal(result.details.resultCount, 2);
  assert.deepEqual(result.details.results.map(({ title }) => title), ["One", "Two"]);
  assert.doesNotMatch(result.text, /Three|must not appear/);
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
  await assert.rejects(() => client.search({ query: "test", category: "github" }), /Unsupported web search category/);
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

test("Firecrawl caps Retry-After delays and retry attempts", async () => {
  let calls = 0;
  const delays = [];
  const client = createFirecrawlClient({
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    fetcher: async () => {
      calls++;
      return jsonResponse({ success: false, error: "still busy" }, {
        status: 503,
        headers: { "retry-after": "86400" },
      });
    },
  });

  await assert.rejects(() => client.search({ query: "retry cap" }), /HTTP 503/);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [30_000, 30_000]);
});

test("Firecrawl caps date Retry-After and bounds its fallback delay", async () => {
  let calls = 0;
  const delays = [];
  const client = createFirecrawlClient({
    random: () => 0,
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    fetcher: async () => {
      calls++;
      return jsonResponse({ success: false, error: "still busy" }, {
        status: 503,
        headers: { "retry-after": calls === 1 ? "Wed, 31 Dec 2099 23:59:59 GMT" : "invalid" },
      });
    },
  });

  await assert.rejects(() => client.search({ query: "retry cap" }), /HTTP 503/);
  assert.deepEqual(delays, [30_000, 2_000]);
});

test("Firecrawl errors are actionable and redact the API key", async () => {
  const secret = "fc-do-not-print";
  const denied = createFirecrawlClient({
    getApiKey: () => undefined,
    fetcher: async () => jsonResponse({ success: false, error: "suspicious IP" }, { status: 403 }),
  });
  await assert.rejects(() => denied.search({ query: "test" }), /undocumented.*FIRECRAWL_API_KEY/);

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
  const result = await client.fetchPage({ url: "https://example.com/start?view=main#client-only", fresh: true });

  assert.deepEqual(body, {
    url: "https://example.com/start?view=main",
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
  if (process.platform !== "win32") {
    assert.equal((await stat(dirname(result.details.fullOutputPath))).mode & 0o777, 0o700);
    assert.equal((await stat(result.details.fullOutputPath)).mode & 0o777, 0o600);
  }
  await rm(dirname(result.details.fullOutputPath), { recursive: true, force: true });
});

test("web fetch rejects unsafe URLs and invalid Firecrawl responses", async () => {
  let calls = 0;
  const client = createFirecrawlClient({ fetcher: async () => { calls++; return jsonResponse({ success: true, data: {} }); } });
  await assert.rejects(() => client.fetchPage({ url: "file:///etc/passwd" }), /HTTP or HTTPS/);
  await assert.rejects(() => client.fetchPage({ url: "https://user:pass@example.com" }), /without credentials/);
  for (const url of [
    "https://localhost/private",
    "https://localhost./private",
    "https://service.localhost/private",
    "https://service.local/private",
    "https://service.internal/private",
    "https://service.internal./private",
    "http://127.0.0.1/private",
    "http://10.0.0.1/private",
    "http://[::1]/private",
    "http://[fc00::1]/private",
    "http://[::ffff:127.0.0.1]/private",
  ]) {
    await assert.rejects(() => client.fetchPage({ url }), /public hostname/);
  }
  for (const url of [
    "https://example.com/private?token=do-not-send",
    "https://example.com/private?X-Amz-Signature=do-not-send",
    "https://example.com/private?X-Goog-Signature=do-not-send",
    "https://example.com/private?sv=2024-01-01&se=tomorrow&sig=do-not-send",
    "https://example.com/private?Expires=1&Signature=do-not-send&Key-Pair-Id=cloudfront",
  ]) {
    await assert.rejects(() => client.fetchPage({ url }), (error) => {
      assert.match(error.message, /authentication or signed-access/);
      assert.doesNotMatch(error.message, /do-not-send/);
      return true;
    });
  }
  assert.equal(calls, 0);
  await assert.rejects(() => client.fetchPage({ url: "https://example.com/path?sig=ordinary&view=main" }), /no page content/);
  assert.equal(calls, 1);
  await assert.rejects(() => client.fetchPage({ url: "https://example.com" }), /no page content/);
});

test("Firecrawl response bodies have a hard safety limit", async () => {
  const client = createFirecrawlClient({
    fetcher: async () => new Response("{}", { headers: { "content-length": String(11 * 1024 * 1024) } }),
  });
  await assert.rejects(() => client.search({ query: "large" }), /10\.0MB safety limit/);
});
