import test from "node:test";
import assert from "node:assert/strict";
import webExtension, { classifySearchQuery, formatSearchResults } from "../extensions/web.ts";

function loadTools() {
  const tools = new Map();
  webExtension({ registerTool(tool) { tools.set(tool.name, tool); } });
  return tools;
}

test("extension registers only keyless web search", () => {
  const tools = loadTools();
  assert.deepEqual([...tools.keys()], ["web_search"]);
  assert.match(tools.get("web_search").description, /Every approved query is sent to Exa.*may also be sent.*DuckDuckGo/);
  assert.match(tools.get("web_search").description, /secrets are blocked.*code-like queries require.*confirmation/i);
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

test("web search blocks likely secrets before network access", async () => {
  const tools = loadTools();
  const credential = `AKIA${"A".repeat(16)}`;
  assert.equal(classifySearchQuery(`find ${credential}`), "secret");
  let fetched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched = true; return new Response(); };
  try {
    await assert.rejects(
      () => tools.get("web_search").execute("search", { query: `find ${credential}` }),
      /blocked.*likely credential/i,
    );
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("code-like web queries require interactive approval", async () => {
  const tools = loadTools();
  const query = "const privateValue = loadProjectData();";
  assert.equal(classifySearchQuery(query), "code");
  await assert.rejects(
    () => tools.get("web_search").execute("search", { query }),
    /requires TUI or RPC approval/,
  );

  let confirmation;
  let fetched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetched = true;
    return new Response(JSON.stringify({
      result: { content: [{ type: "text", text: "Title: Approved\nURL: https://example.com/\nText: Result" }] },
    }), { status: 200 });
  };
  try {
    const context = {
      hasUI: true,
      mode: "rpc",
      ui: {
        confirm: async (title, message) => {
          confirmation = { title, message };
          return true;
        },
      },
    };
    const result = await tools.get("web_search").execute("search", { query }, undefined, undefined, context);
    assert.equal(fetched, true);
    assert.match(confirmation.title, /code-like text/);
    assert.match(confirmation.message, /const privateValue/);
    assert.equal(result.details.resultCount, 1);

    fetched = false;
    context.ui.confirm = async () => false;
    await assert.rejects(
      () => tools.get("web_search").execute("search", { query }, undefined, undefined, context),
      /not approved/,
    );
    assert.equal(fetched, false);
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
