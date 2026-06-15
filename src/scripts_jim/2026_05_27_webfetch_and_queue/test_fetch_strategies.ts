/**
 * Test multiple webFetch strategies against URLs that failed in iter-2.
 *
 * Reads test_urls.json, runs each strategy against each URL, classifies the
 * result (success / title_only / wall / fail), and prints a strategy → success
 * matrix so we can pick the best combination.
 *
 * Run: bun src/scripts_jim/2026_05_27_webfetch_and_queue/test_fetch_strategies.ts
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import * as fs from "fs";
import * as path from "path";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

const UAS = {
  desktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  mobile:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  googlebot:
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  bingbot:
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
} as const;

const BROWSER_HEADERS = {
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "DNT": "1",
} as const;

interface FetchAttempt {
  ok: boolean;
  status?: number;
  contentType?: string;
  body?: string;
  error?: string;
}

async function rawFetch(url: string, ua: string, extraHeaders: Record<string, string> = {}): Promise<FetchAttempt> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": ua, ...extraHeaders },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const ct = response.headers.get("content-type") ?? "";
    if (!response.ok) return { ok: false, status: response.status, contentType: ct };
    if (!ct.includes("text/") && !ct.includes("json") && !ct.includes("xml")) {
      return { ok: false, status: response.status, contentType: ct };
    }
    const body = await response.text();
    return { ok: true, status: response.status, contentType: ct, body };
  } catch (err: any) {
    return { ok: false, error: err?.message?.slice(0, 200) ?? "unknown" };
  }
}

function htmlToMarkdownReadability(html: string): string {
  try {
    const { document } = parseHTML(html);
    const article = new Readability(document).parse();
    if (article?.content) {
      const titleLine = article.title ? `# ${article.title}\n\n` : "";
      return titleLine + turndown.turndown(article.content);
    }
  } catch {}
  return "";
}

function htmlToTextFallback(html: string): string {
  // Strip script/style + tags. Coarser than Readability but recovers SPAs / pages
  // where Readability returns nothing.
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

function extractTitleAndMeta(html: string): string {
  try {
    const { document } = parseHTML(html);
    const title = document.querySelector("title")?.textContent ?? "";
    const desc = document.querySelector('meta[name="description"]')?.getAttribute("content")
      ?? document.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? "";
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "";
    const lines = [title, ogTitle, desc].filter(Boolean);
    return lines.join("\n");
  } catch {
    return "";
  }
}

const MIN_GOOD_CONTENT_CHARS = 300;

function classifyContent(html: string): { class: "good" | "short" | "wall" | "empty"; chars: number; preview: string } {
  if (!html) return { class: "empty", chars: 0, preview: "" };
  const md = htmlToMarkdownReadability(html);
  if (md.length >= MIN_GOOD_CONTENT_CHARS) return { class: "good", chars: md.length, preview: md.slice(0, 150) };
  // Try fallback
  const raw = htmlToTextFallback(html);
  if (raw.length >= MIN_GOOD_CONTENT_CHARS) return { class: "good", chars: raw.length, preview: raw.slice(0, 150) };
  if (md.length > 0 || raw.length > 50) return { class: "short", chars: Math.max(md.length, raw.length), preview: (md || raw).slice(0, 150) };
  return { class: "empty", chars: 0, preview: "" };
}

async function tryWayback(originalUrl: string): Promise<FetchAttempt> {
  try {
    const availResp = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(originalUrl)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!availResp.ok) return { ok: false, status: availResp.status, error: "wayback availability" };
    const data: any = await availResp.json();
    const snap: string | undefined = data?.archived_snapshots?.closest?.url;
    if (!snap) return { ok: false, error: "no snapshot" };
    return rawFetch(snap, UAS.desktop, BROWSER_HEADERS);
  } catch (err: any) {
    return { ok: false, error: err?.message?.slice(0, 200) ?? "wayback err" };
  }
}

async function tryArchiveIs(originalUrl: string): Promise<FetchAttempt> {
  // archive.ph (mirror archive.today) has a `newest/<url>` endpoint that
  // redirects to the most recent snapshot. Works for many paywalled sites
  // that wayback gets blocked from.
  try {
    return await rawFetch(`https://archive.ph/newest/${originalUrl}`, UAS.desktop, BROWSER_HEADERS);
  } catch (err: any) {
    return { ok: false, error: err?.message?.slice(0, 200) ?? "archive.is err" };
  }
}

// === Strategies ===

interface StrategyResult {
  strategyName: string;
  attempts: Array<{ how: string; status?: number; error?: string; contentClass: string; chars: number }>;
  final: { contentClass: "good" | "short" | "wall" | "empty"; chars: number; preview: string };
}

async function strategyCurrent(url: string): Promise<StrategyResult> {
  // Existing impl: desktop → mobile on 4xx → wayback.
  const attempts: StrategyResult["attempts"] = [];
  let f = await rawFetch(url, UAS.desktop);
  attempts.push({ how: "desktop", status: f.status, error: f.error, contentClass: f.ok ? "fetched" : "failed", chars: f.body?.length ?? 0 });
  if (!f.ok && f.status && f.status >= 400 && f.status < 500) {
    f = await rawFetch(url, UAS.mobile);
    attempts.push({ how: "mobile", status: f.status, error: f.error, contentClass: f.ok ? "fetched" : "failed", chars: f.body?.length ?? 0 });
  }
  if (!f.ok) {
    f = await tryWayback(url);
    attempts.push({ how: "wayback", status: f.status, error: f.error, contentClass: f.ok ? "fetched" : "failed", chars: f.body?.length ?? 0 });
  }
  const final = f.ok && f.body ? classifyContent(f.body) : { class: "empty" as const, chars: 0, preview: "" };
  return { strategyName: "current", attempts, final };
}

async function strategyV2(url: string): Promise<StrategyResult> {
  // V2: rich headers, multi-UA, content-aware fallback, archive.is + wayback fallback.
  const attempts: StrategyResult["attempts"] = [];

  const tryOne = async (label: string, fn: () => Promise<FetchAttempt>) => {
    const f = await fn();
    const cls = f.ok && f.body ? classifyContent(f.body) : { class: "empty" as const, chars: 0, preview: "" };
    attempts.push({ how: label, status: f.status, error: f.error, contentClass: cls.class, chars: cls.chars });
    return { fetch: f, classified: cls };
  };

  // 1. Desktop with rich headers
  let r = await tryOne("desktop+headers", () => rawFetch(url, UAS.desktop, BROWSER_HEADERS));
  if (r.classified.class === "good") return { strategyName: "v2", attempts, final: r.classified };

  // 2. Mobile with rich headers (if blocked or short)
  if (r.fetch.status === undefined || r.fetch.status >= 400 || r.classified.class === "short" || r.classified.class === "empty") {
    r = await tryOne("mobile+headers", () => rawFetch(url, UAS.mobile, BROWSER_HEADERS));
    if (r.classified.class === "good") return { strategyName: "v2", attempts, final: r.classified };
  }

  // 3. Googlebot UA (many sites whitelist for SEO)
  if (r.classified.class !== "good") {
    r = await tryOne("googlebot", () => rawFetch(url, UAS.googlebot, BROWSER_HEADERS));
    if (r.classified.class === "good") return { strategyName: "v2", attempts, final: r.classified };
  }

  // 4. Wayback
  if (r.classified.class !== "good") {
    r = await tryOne("wayback", () => tryWayback(url));
    if (r.classified.class === "good") return { strategyName: "v2", attempts, final: r.classified };
  }

  // 5. archive.is
  if (r.classified.class !== "good") {
    r = await tryOne("archive.is", () => tryArchiveIs(url));
    if (r.classified.class === "good") return { strategyName: "v2", attempts, final: r.classified };
  }

  return { strategyName: "v2", attempts, final: r.classified };
}

// === Run ===

async function main() {
  const urlsJson = JSON.parse(
    fs.readFileSync(path.join(import.meta.dir, "test_urls.json"), "utf8"),
  );
  const urls: { url: string; classification: string }[] = urlsJson;

  console.log(`Testing ${urls.length} URLs against 2 strategies\n`);

  const results: any[] = [];
  for (const u of urls) {
    console.log(`\n=== ${u.url}`);
    console.log(`    iter-2 classification: ${u.classification}`);

    const r1 = await strategyCurrent(u.url);
    console.log(`  current → ${r1.final.class} (${r1.final.chars} chars)`);
    for (const a of r1.attempts) console.log(`     · ${a.how}: status=${a.status} chars=${a.chars} cls=${a.contentClass}`);

    const r2 = await strategyV2(u.url);
    console.log(`  v2      → ${r2.final.class} (${r2.final.chars} chars)`);
    for (const a of r2.attempts) console.log(`     · ${a.how}: status=${a.status} chars=${a.chars} cls=${a.contentClass}`);

    results.push({ url: u.url, iter2_classification: u.classification, current: r1, v2: r2 });
  }

  const total = results.length;
  const currentGood = results.filter((r) => r.current.final.class === "good").length;
  const v2Good = results.filter((r) => r.v2.final.class === "good").length;

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`current strategy: ${currentGood}/${total} good (${((currentGood / total) * 100).toFixed(0)}%)`);
  console.log(`v2 strategy:      ${v2Good}/${total} good (${((v2Good / total) * 100).toFixed(0)}%)`);

  // Per-domain breakdown
  const byDomain: Record<string, { total: number; current: number; v2: number }> = {};
  for (const r of results) {
    const d = new URL(r.url).hostname.replace(/^www\./, "");
    byDomain[d] = byDomain[d] ?? { total: 0, current: 0, v2: 0 };
    byDomain[d].total++;
    if (r.current.final.class === "good") byDomain[d].current++;
    if (r.v2.final.class === "good") byDomain[d].v2++;
  }
  console.log(`\nBy domain:`);
  for (const [d, c] of Object.entries(byDomain).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${d.padEnd(40)} total=${c.total}  current=${c.current}  v2=${c.v2}`);
  }

  fs.writeFileSync(
    path.join(import.meta.dir, "fetch_strategy_results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(`\nWrote results → fetch_strategy_results.json`);
}

await main();
