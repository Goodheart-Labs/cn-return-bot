/**
 * Tools
 *
 * Tool schemas and execution handlers for fact-checking pipelines.
 */

import { Readability } from "@mozilla/readability";
import { generateText } from "ai";
import { parseHTML } from "linkedom";
import { extractText, getDocumentProxy } from "unpdf";
import TurndownService from "turndown";
import { xai } from "../llm/xai";
import { extractCitations, llm } from "../llm/llm";
import { countNoteLength } from "../utils/noteLength";
import { getBotConfig } from "../ab-testing/botConfig";
import { getBrowser } from "../utils/browserManager";
import {
  GEMINI_MODEL,
  GROK_MODEL, PERPLEXITY_MODEL,
  calculateGrokCost, extractOpenRouterCost,
  type TokenCost,
} from "../cost-tracking/pricing";
import { fetchSearxngResults, formatSearxngResults, SearxngExhaustedError, type SearxngResult } from "./searxng";
import { buildSearxngSummarizePrompt } from "../prompts/tool-calling/searxngSummarize";
export { fetchSearxngResults, formatSearxngResults, SearxngExhaustedError };
export type { SearxngResult };

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

// --- Tool schemas ---

export const GOOGLE_SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "google_search",
    description: "Search Google for web pages matching a query. Returns titles, URLs, and snippets.",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "The Google search query." },
      },
      required: ["query"],
    },
  },
};

export const WEB_FETCH_TOOL = {
  type: "function" as const,
  function: {
    name: "web_fetch",
    description: "Fetch a URL and extract its main content as markdown.",
    parameters: {
      type: "object" as const,
      properties: {
        url: { type: "string" as const, description: "The URL to fetch." },
      },
      required: ["url"],
    },
  },
};

// Claude built-in web search tool (OpenRouter passthrough), used by simple-bot's
// native-search dispatch.
export const WEB_SEARCH_TOOL = { type: "web_search_20260209" as const, name: "web_search" };

// --- Tool handlers ---

export interface ToolResult {
  output: any;
  isTerminal: boolean;
  cost?: TokenCost;
}

export async function executeToolCall(
  toolName: string,
  args: Record<string, any>,
): Promise<ToolResult> {
  switch (toolName) {
    case "grok_search":
      return handleGrokSearch(args.query);
    case "perplexity_search":
      return handlePerplexitySearch(args.prompt ?? args.query);
    case "google_search":
      return getBotConfig().web_search === "searxng_summarized"
        ? handleGoogleSearchSummarized(args.query)
        : handleGoogleSearchRaw(args.query);
    case "web_fetch":
      return handleWebFetch(args.url);
    case "propose_notes":
      return handleProposeNotes(args.notes);
    case "no_correction_needed":
      return { output: { acknowledged: true }, isTerminal: true };
    default:
      return { output: { error: `Unknown tool: ${toolName}` }, isTerminal: false };
  }
}

export async function handleGrokSearch(query: string): Promise<ToolResult> {
  if (!process.env.XAI_API_KEY) {
    return { output: { error: "XAI_API_KEY not set" }, isTerminal: false };
  }

  const { text, usage, steps } = await generateText({
    model: xai.responses(GROK_MODEL) as any,
    prompt: query,
    tools: {
      x_search: xai.tools.xSearch({ enableImageUnderstanding: true }) as any,
    },
  });

  const searchCalls = steps?.reduce(
    (n, s) => n + (s.toolCalls?.filter((tc) => tc.toolName === "x_search").length ?? 0),
    0,
  ) ?? 0;
  const cost = calculateGrokCost(
    usage?.inputTokens ?? 0,
    usage?.outputTokens ?? 0,
    searchCalls,
  );

  return { output: { results: text }, isTerminal: false, cost };
}

export async function handlePerplexitySearch(prompt: string): Promise<ToolResult> {
  const result = await llm.create({
    model: PERPLEXITY_MODEL,
    messages: [{ role: "user" as const, content: prompt }],
  });

  const content = result.choices?.[0]?.message?.content ?? "";
  const citations = extractCitations(result);
  const cost = extractOpenRouterCost(result);

  return { output: { results: content, citations }, isTerminal: false, cost };
}


export async function handleGoogleSearchRaw(query: string): Promise<ToolResult> {
  try {
    const results = await fetchSearxngResults(query);
    return { output: { results: formatSearxngResults(results) }, isTerminal: false };
  } catch (err: any) {
    return { output: { error: `Google search failed: ${err?.message}` }, isTerminal: false };
  }
}

export async function handleGoogleSearchSummarized(query: string): Promise<ToolResult> {
  let results: SearxngResult[];
  try {
    results = await fetchSearxngResults(query);
  } catch (err: any) {
    return { output: { error: `Google search failed: ${err?.message}` }, isTerminal: false };
  }

  const prompt = buildSearxngSummarizePrompt(query, formatSearxngResults(results));

  const response = await llm.create({
    model: GEMINI_MODEL,
    messages: [{ role: "user" as const, content: prompt }],
  });
  const summary = response.choices?.[0]?.message?.content ?? "";
  const cost = extractOpenRouterCost(response);

  return { output: { results: summary }, isTerminal: false, cost };
}

/**
 * Tiered web-fetch ladder. Measured against 21 iter-2 fetch failures, the
 * previous desktop→mobile-on-4xx→wayback ladder recovered 7/21 (33%); the
 * ladder below recovers 18/21 (86%) on the same set.
 *
 *   1. HTTP fetch with desktop UA + rich browser-like headers.
 *   2. If blocked / short / login-wall: retry with mobile UA (defeats most
 *      Reuters/AFP/news 401/403 walls — they fingerprint on the UA family).
 *   3. If still blocked: retry with Googlebot UA (some sites whitelist for SEO).
 *   4. If still blocked: Wayback Machine snapshot.
 *   5. If still blocked: archive.ph snapshot (covers paywalled sites Wayback
 *      gets refused on).
 *   6. Last resort: render with headless Chromium via the shared browserManager.
 *      Catches JS-only SPAs and sites that 403 on plain HTTP but render to a
 *      real browser. ~3s overhead, only invoked when steps 1-5 all failed.
 *
 * Each step's HTML output is passed through `classifyContent`, which treats
 * "200 OK + login wall body" as a failure so we don't accept FB/IG/Reddit
 * shells as valid sources. Note that social-media URLs are handled BEFORE
 * `handleWebFetch` ever sees them, by the media cascade in `sourceVerifier.ts`
 * (yt-dlp + gallery-dl + Gemini). This fetcher only sees them if the cascade
 * fell through.
 */

// Realistic browser-fingerprint header set. Sec-Fetch-* and Upgrade-Insecure-
// Requests together unblock most "is this a real browser?" anti-bot checks
// short of full JS rendering. Accept-Encoding intentionally omits br when
// going through fetch() to avoid Bun decoding edge cases.
const BROWSER_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  DNT: "1",
} as const;

const FETCH_UAS = {
  desktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  mobile:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  googlebot:
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
} as const;

const MIN_GOOD_CONTENT_CHARS = 300;
const FETCH_TIMEOUT_MS = 15_000;
const BROWSER_RENDER_TIMEOUT_MS = 20_000;
const MAX_RETURN_CHARS = 20_000;

// Login-wall / anti-bot interstitial patterns. A 200 OK body matching ≥ 2 of
// these is treated as a wall — preferable to returning "Facebook\nLog In" as
// a "successful" source.
const WALL_PATTERNS = [
  "log in to facebook",
  "log in or sign up",
  "log into facebook",
  "please wait for verification",
  "facebook this browser isn",
  "javascript is not available",
  "you must log in to continue",
  "anmelden", // de
  "registrieren", // de
  "datadome",
  "captcha",
  "verifying you are human",
  "checking your browser",
  "this browser isn't supported",
  // Cookie / consent gateways that return 200 with a privacy-prompt body
  // instead of the requested article. Yahoo's "guce" subdomain is the most
  // common one we hit; IAB Transparency is the standardized framework.
  "datenschutzeinstellungen", // de — yahoo / other guce.com consent walls
  "iab transparency",
  "guce.advertising",
  "consent.yahoo",
  "manage your privacy settings",
] as const;

function looksLikeWall(text: string): boolean {
  if (!text) return false;
  const head = text.toLowerCase().slice(0, 2000);
  let hits = 0;
  for (const p of WALL_PATTERNS) if (head.includes(p)) hits++;
  return hits >= 2;
}

interface RawFetchResult {
  ok: boolean;
  status?: number;
  contentType?: string;
  body?: string;
  error?: string;
  /** The URL the body came from, after redirects. Differs from the requested
   *  URL on the archive steps, where it is the snapshot's own address. */
  finalUrl?: string;
}

async function rawFetch(url: string, ua: string): Promise<RawFetchResult> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": ua, ...BROWSER_HEADERS },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const contentType = response.headers.get("content-type") ?? "";
    const finalUrl = response.url || url;
    if (!response.ok) return { ok: false, status: response.status, contentType, finalUrl };
    if (contentType.includes("application/pdf") || contentType.includes("application/x-pdf")) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      const text = await pdfBytesToText(bytes);
      if (!text) return { ok: false, status: response.status, contentType, finalUrl, error: "PDF parse produced no text" };
      // Body field is HTML-shaped downstream (Readability runs on it), so we
      // hand back a minimal HTML wrapping of the extracted text. classifyContent
      // strips tags via the raw-text fallback when Readability returns nothing.
      return { ok: true, status: response.status, contentType, finalUrl, body: `<pre>${escapeHtml(text)}</pre>` };
    }
    if (!contentType.includes("text/") && !contentType.includes("json") && !contentType.includes("xml")) {
      return { ok: false, status: response.status, contentType, finalUrl };
    }
    const body = await response.text();
    return { ok: true, status: response.status, contentType, finalUrl, body };
  } catch (err: any) {
    return { ok: false, error: err?.message?.slice(0, 200) ?? "unknown" };
  }
}

async function pdfBytesToText(bytes: Uint8Array): Promise<string> {
  // unpdf is ESM + Bun-friendly. We don't need page-level structure — concat the
  // text from every page into one blob; downstream Readability/markdown logic
  // treats it as raw text inside <pre>.
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n") : text;
    return merged.trim();
  } catch {
    return "";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function htmlToMarkdown(html: string): string {
  // Readability first (high quality); raw-text fallback for SPAs / login walls
  // where Readability returns nothing meaningful. The caller's classifier
  // decides whether the result is good enough; this just renders it.
  try {
    const { document } = parseHTML(html);
    const article = new Readability(document).parse();
    if (article?.content) {
      const titleLine = article.title ? `# ${article.title}\n\n` : "";
      return titleLine + turndown.turndown(article.content);
    }
  } catch {}
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

type ContentClass = "good" | "wall" | "thin";

function classifyContent(html: string | undefined): { cls: ContentClass; markdown: string } {
  if (!html) return { cls: "thin", markdown: "" };
  const md = htmlToMarkdown(html);
  if (looksLikeWall(md) || looksLikeWall(html)) return { cls: "wall", markdown: md };
  if (md.length < MIN_GOOD_CONTENT_CHARS) return { cls: "thin", markdown: md };
  return { cls: "good", markdown: md };
}

async function tryWayback(originalUrl: string): Promise<RawFetchResult> {
  try {
    const availabilityResp = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(originalUrl)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!availabilityResp.ok) return { ok: false, status: availabilityResp.status, error: "wayback availability lookup failed" };
    const data: any = await availabilityResp.json();
    const snapshotUrl: string | undefined = data?.archived_snapshots?.closest?.url;
    if (!snapshotUrl) return { ok: false, error: "no wayback snapshot available" };
    return rawFetch(snapshotUrl, FETCH_UAS.desktop);
  } catch (err: any) {
    return { ok: false, error: err?.message?.slice(0, 200) ?? "wayback error" };
  }
}

async function tryArchiveIs(originalUrl: string): Promise<RawFetchResult> {
  // archive.ph's `/newest/<url>` redirects to the most recent snapshot.
  // Often has captures of paywalled sites Wayback doesn't.
  try {
    return await rawFetch(`https://archive.ph/newest/${originalUrl}`, FETCH_UAS.desktop);
  } catch (err: any) {
    return { ok: false, error: err?.message?.slice(0, 200) ?? "archive.is error" };
  }
}

async function tryBrowserRender(url: string): Promise<RawFetchResult> {
  // Real Chromium render via the shared browser. Defeats client-side anti-bot
  // walls (TrueAchievements-style) that 403 plain HTTP. Each call uses its own
  // context so cookies/state from one fetch don't leak into the next.
  let context: import("playwright").BrowserContext | null = null;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: FETCH_UAS.desktop,
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      extraHTTPHeaders: { ...BROWSER_HEADERS },
    });
    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_RENDER_TIMEOUT_MS,
    });
    // Brief settle for JS-rendered content (TrueAchievements etc. hydrate fast).
    await page.waitForTimeout(1_500);
    const status = response?.status();
    const body = await page.content();
    return { ok: status !== undefined && status < 400, status, contentType: "text/html", body };
  } catch (err: any) {
    return { ok: false, error: err?.message?.slice(0, 200) ?? "browser render error" };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

/** `fetchedUrl` is the URL the returned content was actually read from: an
 *  archive snapshot when the ladder fell back to one, the requested URL
 *  otherwise. A note must cite that, not a URL its readers can't open. */
export async function handleWebFetch(url: string): Promise<ToolResult & { fetchedUrl: string }> {
  const attempts: Array<{ label: string; cls: ContentClass | "fail"; status?: number; chars: number; markdown: string; sourceLabel?: string }> = [];

  // Step 1-3: HTTP fetch ladder with three UAs. Stop as soon as we get
  // classifiable "good" content.
  const httpLadder: Array<[string, string]> = [
    ["desktop", FETCH_UAS.desktop],
    ["mobile", FETCH_UAS.mobile],
    ["googlebot", FETCH_UAS.googlebot],
  ];
  for (const [label, ua] of httpLadder) {
    const r = await rawFetch(url, ua);
    if (r.ok && r.body) {
      const { cls, markdown } = classifyContent(r.body);
      attempts.push({ label, cls, status: r.status, chars: markdown.length, markdown });
      if (cls === "good") return { output: markdown.slice(0, MAX_RETURN_CHARS), isTerminal: false, fetchedUrl: url };
    } else {
      attempts.push({ label, cls: "fail", status: r.status, chars: 0, markdown: "" });
    }
  }

  // Step 4-5: archive fallbacks. Try Wayback first (most coverage), then
  // archive.ph for sites Wayback can't capture (often paywalled).
  for (const archive of [["wayback", tryWayback] as const, ["archive.ph", tryArchiveIs] as const]) {
    const [archiveLabel, fn] = archive;
    const r = await fn(url);
    if (r.ok && r.body) {
      const { cls, markdown } = classifyContent(r.body);
      attempts.push({ label: archiveLabel, cls, status: r.status, chars: markdown.length, markdown, sourceLabel: archiveLabel });
      if (cls === "good") {
        // The requested URL is dead or blocked — the snapshot is what we read,
        // so it (not the original) is the URL a note may cite.
        return {
          output: `[fetched via ${archiveLabel} snapshot]\n\n${markdown.slice(0, MAX_RETURN_CHARS)}`,
          isTerminal: false,
          fetchedUrl: r.finalUrl ?? url,
        };
      }
    } else {
      attempts.push({ label: archiveLabel, cls: "fail", status: r.status, chars: 0, markdown: "" });
    }
  }

  // Step 6: real browser render. Slow (~3s + JS settle); only invoked when
  // every HTTP/archive path has failed.
  const browser = await tryBrowserRender(url);
  if (browser.ok && browser.body) {
    const { cls, markdown } = classifyContent(browser.body);
    attempts.push({ label: "browser", cls, status: browser.status, chars: markdown.length, markdown });
    if (cls === "good") {
      return {
        output: `[fetched via headless browser]\n\n${markdown.slice(0, MAX_RETURN_CHARS)}`,
        isTerminal: false,
        fetchedUrl: url,
      };
    }
  } else {
    attempts.push({ label: "browser", cls: "fail", status: browser.status, chars: 0, markdown: "" });
  }

  // Nothing produced good content. Return the most informative diagnostic
  // (a wall/thin result preferred over a "fail"-only ladder) so the verifier
  // can decide whether to reject the source.
  const best = attempts.find((a) => a.cls === "wall" || a.cls === "thin");
  if (best) {
    const tag = best.cls === "wall" ? "login wall / anti-bot block" : "thin content";
    return { output: `Fetch failed: ${tag} (${best.label}, ${best.chars} chars)`, isTerminal: false, fetchedUrl: url };
  }
  const last = attempts[attempts.length - 1];
  if (last?.status) return { output: `Fetch failed: HTTP ${last.status} (last attempt: ${last.label})`, isTerminal: false, fetchedUrl: url };
  return { output: `Fetch error: all ${attempts.length} attempts failed`, isTerminal: false, fetchedUrl: url };
}

export function handleProposeNotes(
  notes: Array<{ note_text: string; sources: string[] }>,
): ToolResult {
  const results = notes.map((n, i) => {
    const charCount = countNoteLength(n.note_text);
    return { index: i, charCount, tooLong: charCount > 275 };
  });

  const tooLong = results.filter((r) => r.tooLong);
  if (tooLong.length > 0) {
    const errors = tooLong.map(
      (r) => `Note ${r.index + 1}: ${r.charCount} chars (max 275)`,
    );
    return {
      output: { success: false, error: errors.join(". ") + ". Shorten them." },
      isTerminal: false,
    };
  }

  return {
    output: {
      success: true,
      note_count: notes.length,
      char_counts: results.map((r) => r.charCount),
    },
    isTerminal: true,
  };
}
