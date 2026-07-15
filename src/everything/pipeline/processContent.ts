/**
 * Turn fetched content into claims + notes in the everything_* tables.
 *
 * Shared by the queue worker (URL sources) and the local-file importer:
 * extract claims → drop speculation → insert → fact-check the non-confident
 * ones through the note pipeline → record every outcome. Returns the per-item
 * state tally (how many claims landed in each state) for progress reporting.
 */

import PQueue from "p-queue";
import { checkClaim } from "./checkClaims";
import {
  insertClaims,
  insertNote,
  setClaimStatus,
  updateItemMeta,
  type EverythingItem,
  type NewClaimRow,
} from "../db";
import { dropSpeculation, extractClaims, shouldFactCheck } from "./extractClaims";
import type { ExtractedClaim, FetchedContent } from "../types";

const EXTRACTION_CONCURRENCY = 3;
const CHECK_CONCURRENCY = 4;

/** Where every extracted claim ended up, for one item. */
export interface ItemTally {
  extracted: number;
  speculation: number; // future-scenario, dropped before insert
  skipped: number; // confident-true, not fact-checked
  notes: number; // fact-checked → note written
  no_note: number; // fact-checked → no note needed
  errors: number; // fact-check threw
}

function buildClaimRow(itemId: string, claim: ExtractedClaim): NewClaimRow {
  const check = shouldFactCheck(claim.judgement);
  const anchor = claim.anchor;
  return {
    item_id: itemId,
    claim: claim.claim,
    judgement: claim.judgement,
    context_quote: claim.context || null,
    context_paragraph: claim.contextParagraph || null,
    image_urls: claim.imageUrls,
    context_url: anchor.kind === "youtube" ? (anchor.deepLinkUrl ?? null) : anchor.url,
    start_seconds: anchor.kind === "youtube" && anchor.startSeconds !== undefined ? Math.floor(anchor.startSeconds) : null,
    end_seconds: anchor.kind === "youtube" && anchor.endSeconds !== undefined ? Math.ceil(anchor.endSeconds) : null,
    status: check ? "pending" : "skipped",
    status_reason: check ? null : `judged ${claim.judgement}`,
  };
}

/** Fact-check one claim and record it; returns the terminal status for tallying. */
async function checkAndRecordClaim(
  claimId: string,
  claim: ExtractedClaim,
  item: EverythingItem,
  index: number,
  publishedAt: string | undefined,
): Promise<"note" | "no_note" | "error"> {
  try {
    const check = await checkClaim({ claim, source: item.source, itemId: item.id, index, publishedAt });
    if (check.kind === "note") {
      await insertNote(claimId, check.note, check.sources);
      await setClaimStatus(claimId, "note", null);
      console.log(`  ⚠️  NOTE — ${claim.claim}\n      ${check.note}`);
      return "note";
    }
    await setClaimStatus(claimId, "no_note", check.reason ?? check.outcome);
    console.log(`  ✅ no note (${check.reason ?? check.outcome}) — ${claim.claim}`);
    return "no_note";
  } catch (err: any) {
    await setClaimStatus(claimId, "error", err?.message ?? "unknown");
    console.error(`  ❌ error — ${claim.claim}: ${err?.message}`);
    return "error";
  }
}

export async function processFetchedContent(item: EverythingItem, content: FetchedContent): Promise<ItemTally> {
  await updateItemMeta(item.id, { title: content.title, published_at: content.publishedAt?.slice(0, 10) ?? null });
  console.log(`  "${content.title}" (${content.publishedAt?.slice(0, 10) ?? "no date"})`);

  const extracted = await extractClaims(content, EXTRACTION_CONCURRENCY);
  const claims = dropSpeculation(extracted);
  const speculation = extracted.length - claims.length;
  const claimIds = await insertClaims(claims.map((c) => buildClaimRow(item.id, c)));
  const toCheck = claims.filter((c) => shouldFactCheck(c.judgement)).length;
  console.log(
    `  ${extracted.length} claims extracted — dropped ${speculation} speculation, fact-checking ${toCheck} of ${claims.length} (uncertain or below)`,
  );

  const outcomes: Array<"note" | "no_note" | "error"> = [];
  const queue = new PQueue({ concurrency: CHECK_CONCURRENCY });
  claims.forEach((claim, i) => {
    if (!shouldFactCheck(claim.judgement)) return;
    queue.add(async () => {
      outcomes.push(await checkAndRecordClaim(claimIds[i]!, claim, item, i, content.publishedAt));
    });
  });
  await queue.onIdle();

  return {
    extracted: extracted.length,
    speculation,
    skipped: claims.length - toCheck,
    notes: outcomes.filter((o) => o === "note").length,
    no_note: outcomes.filter((o) => o === "no_note").length,
    errors: outcomes.filter((o) => o === "error").length,
  };
}
