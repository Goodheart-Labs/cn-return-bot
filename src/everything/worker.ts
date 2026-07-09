/**
 * Everything-pipeline worker: drain the queue and exit.
 *
 * Takes the oldest queued item, fetches its content (YouTube transcript or
 * Substack article), extracts claims with Opus, fact-checks the non-confident
 * ones through the note pipeline, and streams every step into the
 * everything_* tables — the public frontend updates live via Supabase
 * realtime. One item at a time; item failures don't stop the queue.
 *
 * Usage:
 *   bun run src/everything/worker.ts
 */

import "dotenv/config";
import PQueue from "p-queue";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { checkClaim } from "./checkClaims";
import {
  claimNextQueuedItem,
  insertClaims,
  insertNote,
  markItemDone,
  markItemError,
  setClaimStatus,
  updateItemMeta,
  type EverythingItem,
  type NewClaimRow,
} from "./db";
import { extractClaims, shouldFactCheck } from "./extractClaims";
import { fetchSubstackPost } from "./sources/substack";
import { ensureYtDlp, fetchYoutubeContent } from "./sources/youtube";
import type { ExtractedClaim, FetchedContent } from "./types";

const EXTRACTION_CONCURRENCY = 3;
const CHECK_CONCURRENCY = 4;

async function fetchContent(item: EverythingItem): Promise<FetchedContent> {
  switch (item.source) {
    case "youtube":
      return fetchYoutubeContent(item.url);
    case "substack":
      return fetchSubstackPost(item.url);
  }
}

function buildClaimRow(itemId: string, claim: ExtractedClaim): NewClaimRow {
  const check = shouldFactCheck(claim.judgement);
  const anchor = claim.anchor;
  return {
    item_id: itemId,
    claim: claim.claim,
    judgement: claim.judgement,
    context_quote: claim.context,
    context_url: anchor.kind === "youtube" ? (anchor.deepLinkUrl ?? null) : anchor.url,
    start_seconds: anchor.kind === "youtube" && anchor.startSeconds !== undefined ? Math.floor(anchor.startSeconds) : null,
    end_seconds: anchor.kind === "youtube" && anchor.endSeconds !== undefined ? Math.ceil(anchor.endSeconds) : null,
    status: check ? "pending" : "skipped",
    status_reason: check ? null : `judged ${claim.judgement}`,
  };
}

async function checkAndRecordClaim(
  claimId: string,
  claim: ExtractedClaim,
  item: EverythingItem,
  index: number,
  publishedAt: string | undefined,
): Promise<void> {
  try {
    const check = await checkClaim({ claim, source: item.source, itemId: item.id, index, publishedAt });
    if (check.kind === "note") {
      await insertNote(claimId, check.note, check.sources);
      await setClaimStatus(claimId, "note", null);
      console.log(`  ⚠️  NOTE — ${claim.claim}\n      ${check.note}`);
    } else {
      await setClaimStatus(claimId, "no_note", check.reason ?? check.outcome);
      console.log(`  ✅ no note (${check.reason ?? check.outcome}) — ${claim.claim}`);
    }
  } catch (err: any) {
    await setClaimStatus(claimId, "error", err?.message ?? "unknown");
    console.error(`  ❌ error — ${claim.claim}: ${err?.message}`);
  }
}

async function processItem(item: EverythingItem): Promise<void> {
  const content = await fetchContent(item);
  await updateItemMeta(item.id, { title: content.title, published_at: content.publishedAt?.slice(0, 10) ?? null });
  console.log(`  "${content.title}" (${content.publishedAt?.slice(0, 10) ?? "no date"})`);

  const claims = await extractClaims(content, EXTRACTION_CONCURRENCY);
  const claimIds = await insertClaims(claims.map((c) => buildClaimRow(item.id, c)));
  const pending = claims.filter((c) => shouldFactCheck(c.judgement)).length;
  console.log(`  ${claims.length} claims extracted — fact-checking ${pending} (uncertain or below)`);

  const queue = new PQueue({ concurrency: CHECK_CONCURRENCY });
  claims.forEach((claim, i) => {
    if (!shouldFactCheck(claim.judgement)) return;
    queue.add(() => checkAndRecordClaim(claimIds[i]!, claim, item, i, content.publishedAt));
  });
  await queue.onIdle();
}

async function main() {
  ensureYtDlp();
  let processed = 0;
  while (true) {
    const item = await claimNextQueuedItem();
    if (!item) break;
    console.log(`\n=== [${item.source}] ${item.url}`);
    try {
      await processItem(item);
      await markItemDone(item.id);
    } catch (err: any) {
      console.error(`  Item failed: ${err?.message}`);
      await markItemError(item.id, err?.message ?? "unknown");
    }
    processed++;
  }
  console.log(processed ? `\nDone — processed ${processed} item(s)` : "Queue empty — nothing to do");
  try {
    await closeBrowser();
  } catch {}
}

main().catch((err) => {
  console.error("[worker] Fatal error:", err);
  process.exit(1);
});
