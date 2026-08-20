import { parseHTML } from "linkedom";

const EXA_MCP_URL = "https://mcp.exa.ai/mcp?tools=web_search_exa";
const EXA_TOOL = "web_search_exa";
const PARALLEL_MCP_URL = "https://search.parallel.ai/mcp";
const PARALLEL_TOOL = "web_search";
const SEARCH_TIMEOUT_MS = 30_000;
const MAX_SEARCH_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RESULT_URL_CHARS = 4_096;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
}

export type SearchProvider = "exa-mcp" | "parallel-mcp" | "duckduckgo";

export interface WebSearchResponse extends SearchResponse {
  provider: SearchProvider;
  attemptedProviders: SearchProvider[];
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new Error("Operation aborted");
}

async function readWebResponse(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Response exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit`);
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8");
}

interface McpEnvelope {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code?: number; message?: string };
}

function parseMcpEnvelope(body: string): McpEnvelope | null {
  const payloads = body
    .split(/\r?\n\r?\n/)
    .map((event) => event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim())
    .filter((payload) => payload && payload !== "[DONE]");

  if (payloads.length === 0) payloads.push(body.trim());

  for (const payload of payloads) {
    try {
      const parsed = JSON.parse(payload) as McpEnvelope;
      if (parsed.result || parsed.error) return parsed;
    } catch {
      // Ignore keep-alives and malformed event-stream frames.
    }
  }
  return null;
}

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    const normalized = url.toString();
    return normalized.length <= MAX_RESULT_URL_CHARS ? normalized : null;
  } catch {
    return null;
  }
}

function cleanSnippet(value: unknown, maxLength = 1_000): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text.length > maxLength
    ? maxLength <= 3 ? ".".repeat(maxLength) : `${text.slice(0, maxLength - 3)}...`
    : text;
}

export function parseExaSearchText(text: string, limit = 5): SearchResponse {
  try {
    const payload = JSON.parse(text) as {
      results?: Array<{
        title?: unknown;
        url?: unknown;
        text?: unknown;
        highlights?: unknown;
      }>;
    };
    if (Array.isArray(payload.results)) {
      const results = payload.results
        .map((item, index): SearchResult | null => {
          const url = normalizeHttpUrl(item.url);
          if (!url) return null;
          const highlights = Array.isArray(item.highlights)
            ? item.highlights.filter((entry): entry is string => typeof entry === "string").join(" ")
            : "";
          return {
            title: cleanSnippet(item.title, 300) || `Result ${index + 1}`,
            url,
            snippet: cleanSnippet(highlights || item.text),
          };
        })
        .filter((item): item is SearchResult => item !== null)
        .slice(0, limit);
      if (results.length > 0) return { results };
    }
  } catch {
    // The basic Exa MCP tool normally returns formatted text rather than JSON.
  }

  const blocks = text.split(/(?=^Title:\s*)/m).filter((block) => block.trim());
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const url = normalizeHttpUrl(block.match(/^URL:\s*(.+)$/m)?.[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const title = cleanSnippet(block.match(/^Title:\s*(.+)$/m)?.[1], 300) || `Result ${results.length + 1}`;
    const textMarker = block.match(/\n(?:Text|Highlights):\s*(?:\n)?/);
    const snippet = textMarker?.index === undefined
      ? ""
      : cleanSnippet(block.slice(textMarker.index + textMarker[0].length).replace(/\n---\s*$/, ""));
    results.push({ title, url, snippet });
    if (results.length >= limit) break;
  }

  return { results };
}

export function parseParallelSearchText(text: string, limit = 5): SearchResponse {
  try {
    const payload = JSON.parse(text) as {
      results?: Array<{
        title?: unknown;
        url?: unknown;
        excerpts?: unknown;
      }>;
    };
    if (!Array.isArray(payload.results)) return { results: [] };

    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (const item of payload.results) {
      const url = normalizeHttpUrl(item.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const excerpts = Array.isArray(item.excerpts)
        ? item.excerpts.filter((entry): entry is string => typeof entry === "string").join(" ")
        : "";
      results.push({
        title: cleanSnippet(item.title, 300) || `Result ${results.length + 1}`,
        url,
        snippet: cleanSnippet(excerpts),
      });
      if (results.length >= limit) break;
    }
    return { results };
  } catch {
    return { results: [] };
  }
}

export async function searchExa(query: string, limit = 5, signal?: AbortSignal): Promise<SearchResponse> {
  const requestSignal = combinedSignal(signal, SEARCH_TIMEOUT_MS);
  const response = await fetch(EXA_MCP_URL, {
    method: "POST",
    redirect: "error",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "User-Agent": "pi-minimal-web/0.1",
      "x-exa-source": "pi-minimal-web",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: EXA_TOOL, arguments: { query, numResults: limit } },
    }),
    signal: requestSignal,
  });

  if (!response.ok) {
    response.body?.cancel().catch(() => {});
    throw new Error(response.status === 429 ? "Exa search rate limit reached" : `Exa search failed with HTTP ${response.status}`);
  }

  const envelope = parseMcpEnvelope(await readWebResponse(response, MAX_SEARCH_RESPONSE_BYTES));
  if (!envelope) throw new Error("Exa search returned an invalid response");
  if (envelope.error) throw new Error(`Exa search error${envelope.error.code ? ` ${envelope.error.code}` : ""}`);

  const resultText = envelope.result?.content?.find(
    (entry) => entry.type === "text" && typeof entry.text === "string" && entry.text.trim(),
  )?.text;
  if (envelope.result?.isError || !resultText) throw new Error("Exa search returned an error");

  const parsed = parseExaSearchText(resultText, limit);
  if (parsed.results.length === 0) throw new Error("Exa search returned no parseable results");
  return parsed;
}

export async function searchParallel(query: string, limit = 5, signal?: AbortSignal): Promise<SearchResponse> {
  const requestSignal = combinedSignal(signal, SEARCH_TIMEOUT_MS);
  const response = await fetch(PARALLEL_MCP_URL, {
    method: "POST",
    redirect: "error",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "User-Agent": "pi-minimal-web/0.1",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: PARALLEL_TOOL,
        arguments: { objective: query, search_queries: [query] },
      },
    }),
    signal: requestSignal,
  });

  if (!response.ok) {
    response.body?.cancel().catch(() => {});
    throw new Error(response.status === 429 ? "Parallel search rate limit reached" : `Parallel search failed with HTTP ${response.status}`);
  }

  const envelope = parseMcpEnvelope(await readWebResponse(response, MAX_SEARCH_RESPONSE_BYTES));
  if (!envelope) throw new Error("Parallel search returned an invalid response");
  if (envelope.error) throw new Error(`Parallel search error${envelope.error.code ? ` ${envelope.error.code}` : ""}`);

  const resultText = envelope.result?.content?.find(
    (entry) => entry.type === "text" && typeof entry.text === "string" && entry.text.trim(),
  )?.text;
  if (envelope.result?.isError || !resultText) throw new Error("Parallel search returned an error");

  const parsed = parseParallelSearchText(resultText, limit);
  if (parsed.results.length === 0) throw new Error("Parallel search returned no parseable results");
  return parsed;
}

function decodeDuckDuckGoUrl(href: string): string | null {
  try {
    const redirect = new URL(href, "https://html.duckduckgo.com/html/");
    return normalizeHttpUrl(redirect.searchParams.get("uddg") ?? redirect.toString());
  } catch {
    return null;
  }
}

export function parseDuckDuckGoHtml(html: string, limit = 5): SearchResponse {
  const { document } = parseHTML(html);
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const container of document.querySelectorAll(".result")) {
    if (container.classList.contains("result--ad")) continue;
    const anchor = container.querySelector(".result__a");
    const url = decodeDuckDuckGoUrl(anchor?.getAttribute("href")?.trim() ?? "");
    if (!url || seen.has(url)) continue;
    const title = cleanSnippet(anchor?.textContent, 300);
    if (!title) continue;
    seen.add(url);
    results.push({
      title,
      url,
      snippet: cleanSnippet(container.querySelector(".result__snippet")?.textContent),
    });
    if (results.length >= limit) break;
  }

  return { results };
}

export async function searchDuckDuckGo(query: string, limit = 5, signal?: AbortSignal): Promise<SearchResponse> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    headers: {
      Accept: "text/html",
      "User-Agent": "Mozilla/5.0 (compatible; pi-minimal-web/0.1; +https://github.com/badlogic/pi-mono)",
    },
    signal: combinedSignal(signal, SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    response.body?.cancel().catch(() => {});
    throw new Error(`DuckDuckGo search failed with HTTP ${response.status}`);
  }

  const parsed = parseDuckDuckGoHtml(await readWebResponse(response, MAX_SEARCH_RESPONSE_BYTES), limit);
  if (parsed.results.length === 0) throw new Error("DuckDuckGo returned no parseable results");
  return parsed;
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return cleanSnippet(message, 200) || "unknown error";
}

export async function searchWeb(query: string, limit = 5, signal?: AbortSignal): Promise<WebSearchResponse> {
  const overallSignal = combinedSignal(signal, SEARCH_TIMEOUT_MS);
  try {
    return { ...(await searchExa(query, limit, overallSignal)), provider: "exa-mcp", attemptedProviders: ["exa-mcp"] };
  } catch (exaError) {
    if (overallSignal.aborted) throw abortError(overallSignal);
    try {
      return {
        ...(await searchParallel(query, limit, overallSignal)),
        provider: "parallel-mcp",
        attemptedProviders: ["exa-mcp", "parallel-mcp"],
      };
    } catch (parallelError) {
      if (overallSignal.aborted) throw abortError(overallSignal);
      try {
        return {
          ...(await searchDuckDuckGo(query, limit, overallSignal)),
          provider: "duckduckgo",
          attemptedProviders: ["exa-mcp", "parallel-mcp", "duckduckgo"],
        };
      } catch (duckDuckGoError) {
        if (overallSignal.aborted) throw abortError(overallSignal);
        throw new Error(`Keyless web search failed (Exa: ${shortError(exaError)}; Parallel: ${shortError(parallelError)}; DuckDuckGo: ${shortError(duckDuckGoError)})`);
      }
    }
  }
}
