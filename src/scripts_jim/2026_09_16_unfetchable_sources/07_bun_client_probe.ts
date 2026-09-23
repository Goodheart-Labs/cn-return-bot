/**
 * The ladder re-run failed on 36 pages that a plain Python client fetched with
 * the same headers. This probes a few of them with Bun's own fetch, prints the
 * error or status Bun sees, and for a 200 compares how much text the pipeline's
 * Readability + Turndown extraction keeps against the raw text in the page.
 *
 *   bun run src/scripts_jim/2026_09_16_unfetchable_sources/07_bun_client_probe.ts
 */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none", "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1", DNT: "1",
};
const URLS = [
  "https://www.washingtonpost.com/nation/2026/09/04/judge-lindsay-clancy-trial-declines-remove-juror-deliberations/",
  "https://www.usnews.com/news/top-news/articles/2026-09-04/us-justice-department-pauses-cooperation-with-canadian-government-wsj-reports",
  "https://factcheck.afp.com/doc.afp.com.A33U6G3",
  "https://www.defense.gov/News/News-Stories/Article/Article/3741245/kabul-airport-attack-review-reaffirms-initial-findings-identifies-attacker/",
  "https://www.sec.gov/newsroom/press-releases/2004-98-statement-concerning-sec-terrorist-attack-trading-investigation",
  "https://www.bls.gov/opub/ted/2026/consumer-prices-up-3-4-over-the-year-in-july-2026.htm",
  "https://www.theifab.com/laws/latest/the-penalty-kick/",
  "https://www.nps.gov/flni/learn/historyculture/frequently-asked-questions.htm",
];

const turndown = new TurndownService();
function readabilityChars(html: string): number {
  try {
    const { document } = parseHTML(html);
    const article = new Readability(document).parse();
    return article?.content ? turndown.turndown(article.content).length : 0;
  } catch { return -1; }
}
function rawTextChars(html: string): number {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

for (const url of URLS) {
  try {
    const r = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    const html = await r.text();
    console.log(`${r.status} readability=${readabilityChars(html)} raw=${rawTextChars(html)} enc=${r.headers.get("content-encoding") ?? "-"} ${url}`);
  } catch (err: any) {
    console.log(`ERROR ${err?.name}: ${String(err?.message).slice(0, 120)} ${url}`);
  }
}
