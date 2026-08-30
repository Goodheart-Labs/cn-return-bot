/**
 * Step-through debug harness for the everything pipeline on a SINGLE input.
 *
 * It runs the real pipeline functions in the order the queue worker uses. It
 * fetches the content, extracts the claims, drops the speculative ones, and
 * fact-checks the rest. It leaves out everything that touches the queue and the
 * database, so it never calls insertClaims or insertNote and never changes an
 * item's status. That makes it safe to run against the prod backend. It reads
 * nothing from the everything_* tables and writes nothing to them. It only
 * exercises the fetching and the LLM code paths, so you can set a breakpoint
 * anywhere and inspect the data.
 *
 * Concurrency is pinned to 1 everywhere so that stepping stays linear.
 *
 * Usage:
 *   bun run src/everything/debug/debugItem.ts [<url>] [--claim N] [--all]
 *
 *   <url>       YouTube video or Substack post (default: the Zvi post below)
 *   --claim N   fact-check only the Nth fact-checkable claim (0-based; default 0)
 *   --all       fact-check every fact-checkable claim instead of just one
 *
 * Breakpoint suggestions:
 *   sources/substack.ts:fetchSubstackPost   — HTML fetch + strip
 *   extractClaims.ts:extractClaims          — Opus claim extraction + parsing
 *   extractClaims.ts:shouldFactCheck        — which claims get checked
 *   checkClaims.ts:checkClaim               — claim → synthetic post → note pipeline
 *   pipeline/orchestration/processTweet.ts  — search / write / verify
 */

import "dotenv/config";
import { checkClaim } from "../pipeline/checkClaims";
import { dropSpeculation, extractClaims, shouldFactCheck } from "../pipeline/extractClaims";
import { fetchSubstackPost } from "../sources/substack";
import { ensureYtDlp, fetchYoutubeContent } from "../sources/youtube";
import { closeBrowser } from "../../pipeline/utils/browserManager";
import type { FetchedContent, SourceKind } from "../types";

const DEFAULT_URL = "https://thezvi.substack.com/p/twitter-thoughts-for-you";
// Pinned to 1 so extraction runs one LLM call at a time and stepping stays linear.
const STEP_CONCURRENCY = 1;

function parseArgs() {
  const args = process.argv.slice(2);
  const claimIdx = args.indexOf("--claim");
  const claim = claimIdx !== -1 ? Number(args[claimIdx + 1]) : 0;
  const all = args.includes("--all");
  const url = args.find((a, i) => !a.startsWith("--") && i !== claimIdx + 1) ?? DEFAULT_URL;
  return { url, claim, all };
}

function sourceFor(url: string): SourceKind {
  return /youtube\.com|youtu\.be/.test(url) ? "youtube" : "substack";
}

async function fetchContent(url: string, source: SourceKind): Promise<FetchedContent> {
  if (source === "youtube") {
    ensureYtDlp();
    return fetchYoutubeContent(url);
  }
  return fetchSubstackPost(url);
}

async function main() {
  const { url, claim: claimIndex, all } = parseArgs();
  const source = sourceFor(url);
  console.log(`\n=== debug [${source}] ${url}\n`);

  // ── Step 1: fetch the raw content (breakpoint inside fetchSubstackPost) ──
  const content = await fetchContent(url, source);
  console.log(`Title: ${content.title}`);
  console.log(`Published: ${content.publishedAt?.slice(0, 10) ?? "no date"}`);
  const bodyLen = content.kind === "substack" ? content.text.length : content.cues.length;
  console.log(`Body: ${bodyLen}${content.kind === "substack" ? " chars" : " subtitle cues"}\n`);

  // ── Step 2: extract claims (breakpoint inside extractClaims) ──
  const extracted = await extractClaims(content, STEP_CONCURRENCY);
  const claims = dropSpeculation(extracted);
  const toCheck = claims.filter((c) => shouldFactCheck(c.judgement));
  console.log(
    `Extracted ${extracted.length} claims — dropped ${extracted.length - claims.length} speculation, ` +
      `${toCheck.length} of ${claims.length} are fact-checkable (uncertain or below):\n`,
  );
  toCheck.forEach((c, i) => console.log(`  [${i}] (${c.judgement}) ${c.claim}`));
  console.log("");

  if (toCheck.length === 0) {
    console.log("No fact-checkable claims — nothing to run through the note pipeline.");
    return;
  }

  // ── Step 3: fact-check (breakpoint inside checkClaim → processSingleTweet) ──
  const targets = all ? toCheck : [toCheck[claimIndex]].filter(Boolean);
  if (targets.length === 0) {
    console.log(`--claim ${claimIndex} out of range (0..${toCheck.length - 1}).`);
    return;
  }

  for (let i = 0; i < targets.length; i++) {
    const claim = targets[i]!;
    console.log(`\n--- checking claim: ${claim.claim}`);
    const check = await checkClaim({ claim, source, itemId: `debugitm-${i}`, claimId: null, index: i, publishedAt: content.publishedAt });
    if (check.kind === "note") {
      console.log(`  ⚠️  NOTE: ${check.note}`);
      check.sources.forEach((s) => console.log(`      source: ${s.url}${s.quote ? `\n        “${s.quote}”` : ""}`));
    } else {
      console.log(`  ✅ no note (${check.reason ?? check.outcome})`);
    }
  }
}

main()
  .catch((err) => {
    console.error("[debugItem] Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeBrowser();
    } catch {}
  });
