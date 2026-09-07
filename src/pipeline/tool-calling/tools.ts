/**
 * The tool schemas and the handlers that execute them, for the fact-checking
 * pipelines.
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
import { fetchSearchResults, formatSearchResults, SearchUnavailableError, type SearchResult } from "./serper";
import { buildSearchSummarizePrompt } from "../prompts/tool-calling/searchSummarize";
export { fetchSearchResults, formatSearchResults, SearchUnavailableError };
export type { SearchResult };

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

// Claude's built-in web search tool, which OpenRouter passes through. The
// native-search dispatch of simple-bot uses it.
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
      return getBotConfig().web_search === "serper_summarized"
        ? handleGoogleSearchSummarized(args.query)
        : handleGoogleSearchRaw(args.query);
    case "web_fetch":
      return { output: (await fetchWebPage(args.url)).content, isTerminal: false };
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
    const results = await fetchSearchResults(query);
    return { output: { results: formatSearchResults(results) }, isTerminal: false };
  } catch (err: any) {
    return { output: { error: `Google search failed: ${err?.message}` }, isTerminal: false };
  }
}

export async function handleGoogleSearchSummarized(query: string): Promise<ToolResult> {
  let results: SearchResult[];
  try {
    results = await fetchSearchResults(query);
  } catch (err: any) {
    return { output: { error: `Google search failed: ${err?.message}` }, isTerminal: false };
  }

  const prompt = buildSearchSummarizePrompt(query, formatSearchResults(results));

  const response = await llm.create({
    model: GEMINI_MODEL,
    messages: [{ role: "user" as const, content: prompt }],
  });
  const summary = response.choices?.[0]?.message?.content ?? "";
  const cost = extractOpenRouterCost(response);

  return { output: { results: summary }, isTerminal: false, cost };
}

/**
 * The tiered ladder that `fetchWebPage` walks. It was measured against the 21
 * fetch failures from the iter-2 evaluation run. The earlier ladder tried a
 * desktop user agent, then a mobile one on a 4xx, then Wayback, and it recovered
 * 7 of those 21, which is 33 percent. The ladder below recovers 18 of the same
 * 21, which is 86 percent.
 *
 *   1. An HTTP fetch with the desktop user agent and a rich set of browser-like
 *      headers.
 *   2. If the answer is blocked, too short, or a login wall, retry with the
 *      mobile user agent. This defeats most of the 401 and 403 walls on news
 *      sites such as Reuters and AFP, because they fingerprint the user agent
 *      family.
 *   3. If it is still blocked, retry with the Googlebot user agent. Some sites
 *      let Googlebot through for the sake of their search ranking.
 *   4. If it is still blocked, read a Wayback Machine snapshot.
 *   5. If it is still blocked, read an archive.ph snapshot. That site has
 *      captures of paywalled pages Wayback is refused on.
 *   6. As a last resort, render the page with headless Chromium through the
 *      shared browserManager. This catches single-page apps that only work with
 *      JavaScript, and sites that answer 403 to a plain HTTP request but render
 *      fine for a real browser. It costs about 3 seconds, so it only runs when
 *      steps 1 to 5 have all failed.
 *
 * The HTML each step produces goes through `classifyContent`. That function
 * counts a 200 OK whose body is a login wall as a failure, so we never accept a
 * Facebook, Instagram or Reddit shell page as a valid source. Social media URLs
 * normally never reach `fetchWebPage` at all. The media cascade in
 * `sourceVerifier.ts` handles them first with yt-dlp, gallery-dl and Gemini. This
 * fetcher only sees such a URL when that cascade fell through.
 */

// A header set that looks like a real browser. The Sec-Fetch-* headers together
// with Upgrade-Insecure-Requests get us past most anti-bot checks that ask
// whether this is a real browser, short of the ones that need JavaScript to run.
// We deliberately set no Accept-Encoding header here. That leaves the choice to
// fetch() and avoids the edge cases Bun has when it decodes brotli.
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

// Patterns that mark a login wall or an anti-bot interstitial page. A body that
// came back 200 OK and matches two or more of them counts as a wall. That is
// better than returning "Facebook\nLog In" as a successful source.
const WALL_PATTERNS = [
  "log in to facebook",
  "log in or sign up",
  "log into facebook",
  "please wait for verification",
  "facebook this browser isn",
  "javascript is not available",
  "you must log in to continue",
  "anmelden", // German
  "registrieren", // German
  "datadome",
  "captcha",
  "verifying you are human",
  "checking your browser",
  "this browser isn't supported",
  // Cookie and consent gateways answer 200 with a privacy prompt instead of the
  // article we asked for. Yahoo's "guce" subdomain is the one we hit most often.
  // IAB Transparency is the standard framework these prompts are built on.
  "datenschutzeinstellungen", // German, on Yahoo and other guce.com consent walls
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
      // Everything downstream treats the body as HTML, because Readability runs
      // on it. So we wrap the extracted text in a minimal piece of HTML. When
      // Readability finds nothing in that wrapper, classifyContent falls back to
      // stripping the tags as raw text.
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
  // We use unpdf because it is an ESM package and works well under Bun. We do not
  // need the page structure, so we join the text of every page into one string.
  // The Readability and markdown code downstream treats it as raw text inside a
  // <pre> element.
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
  // We try Readability first because it gives the best result. When it returns
  // nothing meaningful, which happens on single-page apps and login walls, we
  // fall back to stripping the tags ourselves. This function only renders the
  // page. The caller's classifier decides whether the result is good enough.
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
  // The `/newest/<url>` path on archive.ph redirects to the most recent snapshot.
  // That site often has captures of paywalled pages that Wayback does not have.
  try {
    return await rawFetch(`https://archive.ph/newest/${originalUrl}`, FETCH_UAS.desktop);
  } catch (err: any) {
    return { ok: false, error: err?.message?.slice(0, 200) ?? "archive.is error" };
  }
}

async function tryBrowserRender(url: string): Promise<RawFetchResult> {
  // Render the page in a real Chromium through the shared browser. This defeats
  // the client-side anti-bot walls, such as the one on TrueAchievements, that
  // answer 403 to a plain HTTP request. Each call gets its own browser context,
  // so cookies and other state from one fetch cannot leak into the next.
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
    // Wait a moment so that content rendered by JavaScript can appear. Sites like
    // TrueAchievements hydrate quickly.
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

export interface WebFetchResult {
  /** The page as markdown. When the fetch failed it holds a diagnostic message
   *  that starts with "Fetch failed:" or "Fetch error:". */
  content: string;
  /** The URL the content was actually read from. It is the archive snapshot when
   *  the ladder fell back to one, and the requested URL otherwise. Any caller
   *  that publishes the source, such as the note's citation, must use this URL
   *  and not the requested one. */
  fetchedUrl: string;
  ok: boolean;
}

/** `maxChars` overrides the default return cap. The default is sized for a
 *  verifier's context window; the everything pipeline passes a much larger cap
 *  because it ingests the whole article. */
export async function fetchWebPage(url: string, opts?: { maxChars?: number }): Promise<WebFetchResult> {
  const maxChars = opts?.maxChars ?? MAX_RETURN_CHARS;
  const attempts: Array<{ label: string; cls: ContentClass | "fail"; status?: number; chars: number; markdown: string; sourceLabel?: string }> = [];

  // Steps 1 to 3 are the HTTP ladder with three user agents. We stop as soon as
  // one of them yields content that classifies as good.
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
      if (cls === "good") return { content: markdown.slice(0, maxChars), fetchedUrl: url, ok: true };
    } else {
      attempts.push({ label, cls: "fail", status: r.status, chars: 0, markdown: "" });
    }
  }

  // Steps 4 and 5 are the archive fallbacks. Wayback comes first because it has
  // the widest coverage. archive.ph comes second and covers the sites Wayback
  // cannot capture, which are often paywalled.
  for (const archive of [["wayback", tryWayback] as const, ["archive.ph", tryArchiveIs] as const]) {
    const [archiveLabel, fn] = archive;
    const r = await fn(url);
    if (r.ok && r.body) {
      const { cls, markdown } = classifyContent(r.body);
      attempts.push({ label: archiveLabel, cls, status: r.status, chars: markdown.length, markdown, sourceLabel: archiveLabel });
      if (cls === "good") {
        // The requested URL is dead or blocked. We read the snapshot instead, so
        // the snapshot is the URL a note may cite, not the original.
        return {
          content: `[fetched via ${archiveLabel} snapshot]\n\n${markdown.slice(0, maxChars)}`,
          fetchedUrl: r.finalUrl ?? url,
          ok: true,
        };
      }
    } else {
      attempts.push({ label: archiveLabel, cls: "fail", status: r.status, chars: 0, markdown: "" });
    }
  }

  // Step 6 renders the page in a real browser. It is slow, about 3 seconds plus
  // the wait for JavaScript to settle, so it only runs once every HTTP path and
  // archive path has failed.
  const browser = await tryBrowserRender(url);
  if (browser.ok && browser.body) {
    const { cls, markdown } = classifyContent(browser.body);
    attempts.push({ label: "browser", cls, status: browser.status, chars: markdown.length, markdown });
    if (cls === "good") {
      return {
        content: `[fetched via headless browser]\n\n${markdown.slice(0, maxChars)}`,
        fetchedUrl: url,
        ok: true,
      };
    }
  } else {
    attempts.push({ label: "browser", cls: "fail", status: browser.status, chars: 0, markdown: "" });
  }

  // Nothing produced good content. We return the most informative diagnostic we
  // have. A wall or a thin result says more than a ladder of plain failures, so
  // we prefer it. The verifier uses this to decide whether to reject the source.
  const best = attempts.find((a) => a.cls === "wall" || a.cls === "thin");
  if (best) {
    const tag = best.cls === "wall" ? "login wall / anti-bot block" : "thin content";
    return { content: `Fetch failed: ${tag} (${best.label}, ${best.chars} chars)`, fetchedUrl: url, ok: false };
  }
  const last = attempts[attempts.length - 1];
  const failure = last?.status
    ? `Fetch failed: HTTP ${last.status} (last attempt: ${last.label})`
    : `Fetch error: all ${attempts.length} attempts failed`;
  return { content: failure, fetchedUrl: url, ok: false };
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
