import { lookup as dnsLookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";
import type { Readable } from "node:stream";
import { gunzip, inflate, brotliDecompress } from "node:zlib";
import { promisify } from "node:util";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const EXA_MCP_URL = "https://mcp.exa.ai/mcp?tools=web_search_exa";
const EXA_TOOL = "web_search_exa";
const JINA_READER_BASE = "https://r.jina.ai/";
const SEARCH_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 30_000;
const ADDRESS_TIMEOUT_MS = 10_000;
const MAX_SEARCH_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_FETCH_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const brotliDecompressAsync = promisify(brotliDecompress);

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  rawText?: string;
}

export interface WebSearchResponse extends SearchResponse {
  provider: "exa-mcp" | "duckduckgo";
}

export interface FetchedPage {
  url: string;
  title: string;
  content: string;
  contentType: string;
  status: number;
  source: "direct" | "jina-reader";
}

export type ReaderMode = "auto" | "never" | "always";
export type LookupAddress = { address: string; family: number };
export type DnsLookup = (hostname: string) => Promise<LookupAddress[]>;

interface ResolvedTarget {
  url: URL;
  addresses: LookupAddress[];
}

interface RawHttpResponse {
  url: URL;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export class UnsafeUrlError extends Error {}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new Error("Operation aborted");
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError(signal);

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function readWebResponse(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
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
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");

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
    return url.toString();
  } catch {
    return null;
  }
}

function cleanSnippet(value: unknown, maxLength = 1_000): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
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

  return results.length > 0 ? { results } : { results: [], rawText: cleanSnippet(text, 8_000) };
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

  return parseExaSearchText(resultText, limit);
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
  try {
    return { ...(await searchExa(query, limit, signal)), provider: "exa-mcp" };
  } catch (exaError) {
    if (signal?.aborted) throw abortError(signal);
    try {
      return { ...(await searchDuckDuckGo(query, limit, signal)), provider: "duckduckgo" };
    } catch (duckDuckGoError) {
      if (signal?.aborted) throw abortError(signal);
      throw new Error(`Keyless web search failed (Exa: ${shortError(exaError)}; DuckDuckGo: ${shortError(duckDuckGoError)})`);
    }
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function parseIPv6(address: string): number[] | null {
  let value = address;
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    const ipv4 = value.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) return null;
    const octets = ipv4.split(".").map(Number);
    value = `${value.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const pieces = value.split("::");
  if (pieces.length > 2) return null;
  const left = pieces[0] ? pieces[0].split(":") : [];
  const right = pieces.length === 2 && pieces[1] ? pieces[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((pieces.length === 1 && missing !== 0) || (pieces.length === 2 && missing < 1)) return null;

  const groups = [...left, ...Array(missing).fill("0"), ...right].map((part) =>
    /^[0-9a-f]{1,4}$/i.test(part) ? Number.parseInt(part, 16) : -1,
  );
  return groups.length === 8 && groups.every((group) => group >= 0 && group <= 0xffff) ? groups : null;
}

function isBlockedIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

function isBlockedIPv6(address: string): boolean {
  const groups = parseIPv6(address);
  if (!groups) return true;
  if (groups.every((group) => group === 0)) return true;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;

  const embeddedIPv4 = groups.slice(0, 6).every((group, index) => group === 0 || (index === 5 && group === 0xffff));
  if (embeddedIPv4) {
    const ipv4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
    return isBlockedIPv4(ipv4);
  }

  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00) return true; // Unique-local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // Link-local fe80::/10
  if ((first & 0xffc0) === 0xfec0) return true; // Deprecated site-local fec0::/10
  if ((first & 0xff00) === 0xff00) return true; // Multicast ff00::/8
  if (first === 0x2002) return true; // 6to4 can embed an IPv4 destination
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) return true; // NAT64 ranges
  if (groups[0] === 0x0100 && groups.slice(1, 4).every((group) => group === 0)) return true; // Discard-only 100::/64
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true; // Documentation
  if (groups[0] === 0x2001 && groups[1] === 0x0002) return true; // Benchmarking
  if (groups[0] === 0x2001 && ((groups[1] & 0xfff0) === 0x0010 || (groups[1] & 0xfff0) === 0x0020)) return true; // ORCHID
  return false;
}

export function isPublicIp(address: string): boolean {
  const normalized = normalizeHostname(address);
  const version = isIP(normalized);
  if (version === 4) return !isBlockedIPv4(normalized);
  if (version === 6) return !isBlockedIPv6(normalized);
  return false;
}

const defaultDnsLookup: DnsLookup = async (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export async function resolvePublicUrl(
  rawUrl: string | URL,
  signal?: AbortSignal,
  lookup: DnsLookup = defaultDnsLookup,
): Promise<ResolvedTarget> {
  let url: URL;
  try {
    url = rawUrl instanceof URL ? new URL(rawUrl) : new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only HTTP and HTTPS URLs are allowed");
  }
  if (url.username || url.password) throw new UnsafeUrlError("URLs containing credentials are not allowed");
  url.hash = "";

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) throw new UnsafeUrlError("URL must include a hostname");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "home.arpa" ||
    hostname.endsWith(".home.arpa")
  ) {
    throw new UnsafeUrlError(`Blocked local hostname: ${hostname}`);
  }

  let addresses: LookupAddress[];
  const version = isIP(hostname);
  if (version) {
    addresses = [{ address: hostname, family: version }];
  } else {
    try {
      const lookupPromise = lookup(hostname);
      addresses = signal ? await abortable(lookupPromise, signal) : await lookupPromise;
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to resolve ${hostname}: ${message}`);
    }
  }

  if (addresses.length === 0) throw new Error(`Failed to resolve ${hostname}: no addresses returned`);
  const unique = addresses.filter(
    (entry, index, all) => all.findIndex((candidate) => candidate.address === entry.address) === index,
  );
  for (const entry of unique) {
    if (!isPublicIp(entry.address)) throw new UnsafeUrlError(`Blocked non-public address for ${hostname}`);
  }

  return { url, addresses: unique };
}

function requestAddress(target: ResolvedTarget, address: LookupAddress, signal: AbortSignal): Promise<http.IncomingMessage> {
  const url = target.url;
  const transport = url.protocol === "https:" ? https : http;
  const hostname = normalizeHostname(url.hostname);

  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: url.protocol,
      hostname: address.address,
      family: address.family,
      port: url.port || undefined,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      servername: url.protocol === "https:" && isIP(hostname) === 0 ? hostname : undefined,
      headers: {
        Accept: "text/html, text/markdown, text/plain, application/json, application/xml;q=0.9, */*;q=0.5",
        "Accept-Encoding": "identity",
        Host: url.host,
        "User-Agent": "Mozilla/5.0 (compatible; pi-minimal-web/0.1; +https://github.com/badlogic/pi-mono)",
      },
      signal,
    }, resolve);
    request.once("error", reject);
    request.end();
  });
}

async function requestResolvedTarget(target: ResolvedTarget, signal: AbortSignal): Promise<http.IncomingMessage> {
  let lastError: unknown;
  for (const address of target.addresses) {
    if (signal.aborted) throw abortError(signal);
    const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(ADDRESS_TIMEOUT_MS)]);
    try {
      return await requestAddress(target, address, attemptSignal);
    } catch (error) {
      if (signal.aborted) throw abortError(signal);
      lastError = error;
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError ?? "connection failed");
  throw new Error(`Failed to fetch ${target.url.hostname}: ${message}`);
}

async function readNodeStream(stream: Readable, maxBytes: number, declaredLength?: string): Promise<Buffer> {
  const length = Number(declaredLength);
  if (Number.isFinite(length) && length > maxBytes) {
    stream.destroy();
    throw new Error(`Response exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit`);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of stream) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
    total += chunk.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new Error(`Response exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export async function decompressBody(body: Buffer, encodingHeader: string | undefined): Promise<Buffer> {
  const encoding = encodingHeader?.trim().toLowerCase();
  if (!encoding || encoding === "identity") return body;

  const options = { maxOutputLength: MAX_FETCH_RESPONSE_BYTES };
  if (encoding === "gzip" || encoding === "x-gzip") return gunzipAsync(body, options);
  if (encoding === "deflate") return inflateAsync(body, options);
  if (encoding === "br") return brotliDecompressAsync(body, options);
  throw new Error(`Unsupported content encoding: ${encoding}`);
}

async function fetchHttp(
  initial: ResolvedTarget,
  signal: AbortSignal,
  lookup: DnsLookup = defaultDnsLookup,
): Promise<RawHttpResponse> {
  let target = initial;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await requestResolvedTarget(target, signal);
    const status = response.statusCode ?? 0;
    if (REDIRECT_STATUSES.has(status)) {
      const location = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
      response.resume();
      if (!location) throw new Error(`Redirect from ${target.url.hostname} omitted Location header`);
      if (redirects === MAX_REDIRECTS) throw new Error("Too many redirects");
      target = await resolvePublicUrl(new URL(location, target.url), signal, lookup);
      continue;
    }

    if (status < 200 || status >= 300) {
      response.resume();
      throw new Error(`HTTP ${status} fetching ${target.url.hostname}`);
    }

    const compressed = await readNodeStream(response, MAX_FETCH_RESPONSE_BYTES, response.headers["content-length"]);
    const body = await decompressBody(compressed, response.headers["content-encoding"]);
    if (body.length > MAX_FETCH_RESPONSE_BYTES) throw new Error("Decompressed response exceeds 5MB limit");
    return { url: target.url, status, headers: response.headers, body };
  }

  throw new Error("Too many redirects");
}

function contentType(headers: http.IncomingHttpHeaders): string {
  const value = Array.isArray(headers["content-type"]) ? headers["content-type"][0] : headers["content-type"];
  return value?.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream";
}

function decodeBody(body: Buffer, headers: http.IncomingHttpHeaders): string {
  const rawType = Array.isArray(headers["content-type"]) ? headers["content-type"][0] : headers["content-type"];
  const charset = rawType?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

function absoluteLinks(document: Document, baseUrl: URL): void {
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") anchor.setAttribute("href", resolved.toString());
      else anchor.removeAttribute("href");
    } catch {
      anchor.removeAttribute("href");
    }
  }
  for (const image of document.querySelectorAll("img[src]")) {
    const src = image.getAttribute("src");
    if (!src) continue;
    try {
      const resolved = new URL(src, baseUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") image.setAttribute("src", resolved.toString());
      else image.removeAttribute("src");
    } catch {
      image.removeAttribute("src");
    }
  }
}

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
turndown.remove(["script", "style", "noscript", "template", "iframe", "object", "embed", "svg", "canvas", "form"]);

export function htmlToMarkdown(html: string, baseUrl: URL): { title: string; markdown: string } {
  const { document } = parseHTML(html);
  absoluteLinks(document as unknown as Document, baseUrl);

  for (const element of document.querySelectorAll(
    "script, style, noscript, template, iframe, object, embed, svg, canvas, form, nav, footer, aside, [hidden], [aria-hidden='true']",
  )) {
    element.remove();
  }

  const documentTitle = cleanSnippet(document.title, 500);
  const readableDocument = document.cloneNode(true) as unknown as Document;
  const article = new Readability(readableDocument).parse();
  const fallback = document.querySelector("article, main, [role='main']") ?? document.body;
  const contentHtml = article?.content || fallback?.innerHTML || "";
  const markdown = turndown.turndown(contentHtml)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  return {
    title: cleanSnippet(article?.title, 500) || documentTitle || baseUrl.hostname,
    markdown,
  };
}

function textTitle(text: string, url: URL): string {
  const heading = text.match(/^\s*#{1,6}\s+(.+)$/m)?.[1] ?? text.split(/\r?\n/, 1)[0];
  return cleanSnippet(heading, 300) || url.pathname.split("/").filter(Boolean).pop() || url.hostname;
}

function extractDirect(response: RawHttpResponse): FetchedPage {
  const type = contentType(response.headers);
  const text = decodeBody(response.body, response.headers);

  if (type === "text/html" || type === "application/xhtml+xml" || /<html[\s>]/i.test(text.slice(0, 2_000))) {
    const converted = htmlToMarkdown(text, response.url);
    return {
      url: response.url.toString(),
      title: converted.title,
      content: converted.markdown,
      contentType: type,
      status: response.status,
      source: "direct",
    };
  }

  const isText = type.startsWith("text/") ||
    type === "application/json" ||
    type.endsWith("+json") ||
    type === "application/xml" ||
    type.endsWith("+xml") ||
    type === "application/javascript";
  if (!isText) throw new Error(`Unsupported content type: ${type}`);

  const content = text.trim();
  return {
    url: response.url.toString(),
    title: textTitle(content, response.url),
    content,
    contentType: type,
    status: response.status,
    source: "direct",
  };
}

function readerTargetUrl(target: URL): URL {
  return new URL(`${JINA_READER_BASE}${target.toString()}`);
}

function extractReader(response: RawHttpResponse, originalUrl: URL): FetchedPage {
  const text = decodeBody(response.body, response.headers);
  const marker = text.indexOf("Markdown Content:");
  const metadata = marker >= 0 ? text.slice(0, marker) : "";
  const content = (marker >= 0 ? text.slice(marker + "Markdown Content:".length) : text).trim();
  const title = cleanSnippet(metadata.match(/^Title:\s*(.+)$/m)?.[1], 500) || textTitle(content, originalUrl);
  if (!content) throw new Error("Jina Reader returned empty content");

  return {
    url: originalUrl.toString(),
    title,
    content,
    contentType: "text/markdown",
    status: response.status,
    source: "jina-reader",
  };
}

async function fetchWithReader(target: ResolvedTarget, signal: AbortSignal, lookup: DnsLookup): Promise<FetchedPage> {
  const reader = await resolvePublicUrl(readerTargetUrl(target.url), signal, lookup);
  const response = await fetchHttp(reader, signal, lookup);
  return extractReader(response, target.url);
}

export function shouldUseReaderFallback(page: FetchedPage): boolean {
  return page.content.trim().length === 0;
}

export async function fetchWebPage(
  rawUrl: string,
  options: { signal?: AbortSignal; readerMode?: ReaderMode; lookup?: DnsLookup } = {},
): Promise<FetchedPage> {
  const signal = combinedSignal(options.signal, FETCH_TIMEOUT_MS);
  const lookup = options.lookup ?? defaultDnsLookup;
  const target = await resolvePublicUrl(rawUrl, signal, lookup);
  const readerMode = options.readerMode ?? "auto";

  if (readerMode === "always") return fetchWithReader(target, signal, lookup);

  let directPage: FetchedPage | null = null;
  let directError: unknown;
  try {
    directPage = extractDirect(await fetchHttp(target, signal, lookup));
    // A short but readable direct response is valid and should not be disclosed
    // to Jina merely because of its length. Auto fallback is reserved for an
    // empty extraction or a failed/unsupported direct fetch.
    if (readerMode === "never" || !shouldUseReaderFallback(directPage)) return directPage;
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw error;
    directError = error;
    if (readerMode === "never") throw error;
  }

  try {
    return await fetchWithReader(target, signal, lookup);
  } catch (readerError) {
    if (directPage) return directPage;
    const directMessage = directError instanceof Error ? directError.message : "direct fetch failed";
    const readerMessage = readerError instanceof Error ? readerError.message : "reader fetch failed";
    throw new Error(`Unable to fetch URL (${directMessage}; ${readerMessage})`);
  }
}
