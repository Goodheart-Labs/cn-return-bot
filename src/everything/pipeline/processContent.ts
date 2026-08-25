/**
 * Turns fetched content into claims and notes in the everything_* tables. The
 * queue worker calls this for every item it takes, whatever the item's source
 * is.
 *
 * We extract the claims, drop the speculative ones, insert the rest, then
 * fact-check the ones Opus was not confident about through the note pipeline
 * and record every outcome. The return value counts how many claims of this
 * item ended in each state, which the caller prints as progress.
 */

import PQueue from "p-queue";
import { checkClaim } from "./checkClaims";
import {
  fetchClaimIdsWithAiNotes,
  fetchItemClaims,
  insertClaims,
  insertNote,
  isSyntheticDocUrl,
  setClaimStatus,
  updateItemMeta,
  type EverythingItem,
  type ItemClaimRow,
  type NewClaimRow,
} from "../db";
import { dropSpeculation, extractClaims, shouldFactCheck } from "./extractClaims";
import { spendCapReached } from "../spendCap";
import type { ExtractedClaim, FetchedContent } from "../types";

const EXTRACTION_CONCURRENCY = 3;
const CHECK_CONCURRENCY = 4;

/** Where every extracted claim ended up, for one item. */
export interface ItemTally {
  extracted: number;
  speculation: number; // Claims about a future scenario. We drop them before inserting.
  skipped: number; // Claims Opus was confident are true. We do not fact-check them.
  notes: number; // Claims we fact-checked and wrote a note on.
  no_note: number; // Claims we fact-checked and found no note was needed.
  errors: number; // Claims whose fact-check threw.
  /** Claims left unchecked because the daily spend cap was reached mid-item.
   *  They stay pending in the database, and the caller puts the item back in
   *  the queue so the next day's run resumes exactly these claims. */
  capped: number;
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
    context_url:
      anchor.kind === "youtube" ? (anchor.deepLinkUrl ?? null) : isSyntheticDocUrl(anchor.url) ? null : anchor.url,
    start_seconds: anchor.kind === "youtube" && anchor.startSeconds !== undefined ? Math.floor(anchor.startSeconds) : null,
    end_seconds: anchor.kind === "youtube" && anchor.endSeconds !== undefined ? Math.ceil(anchor.endSeconds) : null,
    status: check ? "pending" : "skipped",
    status_reason: check ? null : `judged ${claim.judgement}`,
  };
}

/** Fact-checks one claim and records the result. Returns the claim's final
 *  status so the caller can tally it. */
async function checkAndRecordClaim(
  claimId: string,
  claim: ExtractedClaim,
  item: EverythingItem,
  index: number,
  publishedAt: string | undefined,
): Promise<"note" | "no_note" | "error"> {
  try {
    const check = await checkClaim({ claim, source: item.source, itemId: item.id, claimId, index, publishedAt });
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

/** The item's body text. This is what the public write-note flow searches. */
function bodyText(content: FetchedContent): string {
  return content.kind === "youtube" ? content.cues.map((c) => c.text).join("\n") : content.text;
}

/** Whether a freshly extracted claim repeats one the item already has. An
 *  item can carry claims before extraction runs: a reader wrote a note on the
 *  page, or an earlier paragraph check finished. Their claims must not be
 *  extracted again, or the same passage would end up with two notes. */
function repeatsExistingClaim(claim: ExtractedClaim, existing: ItemClaimRow[]): boolean {
  const norm = (text: string | null | undefined) => (text ?? "").trim().toLowerCase();
  return existing.some(
    (row) =>
      norm(row.claim) === norm(claim.claim) ||
      (!!row.context_quote && norm(row.context_quote) === norm(claim.context)),
  );
}

export async function processFetchedContent(
  item: EverythingItem,
  content: FetchedContent,
  existingClaims: ItemClaimRow[] = [],
): Promise<ItemTally> {
  await updateItemMeta(item.id, {
    title: content.title,
    published_at: content.publishedAt?.slice(0, 10) ?? null,
    full_text: bodyText(content),
  });
  console.log(`  "${content.title}" (${content.publishedAt?.slice(0, 10) ?? "no date"})`);

  const extracted = await extractClaims(content, EXTRACTION_CONCURRENCY);
  const fresh = dropSpeculation(extracted);
  const duplicates = fresh.filter((c) => repeatsExistingClaim(c, existingClaims)).length;
  if (duplicates > 0) console.log(`  dropped ${duplicates} claims the item already carries`);
  const claims = fresh.filter((c) => !repeatsExistingClaim(c, existingClaims));
  const speculation = extracted.length - fresh.length;
  const claimIds = await insertClaims(claims.map((c) => buildClaimRow(item.id, c)));
  const toCheck = claims.filter((c) => shouldFactCheck(c.judgement)).length;
  console.log(
    `  ${extracted.length} claims extracted — dropped ${speculation} speculation, fact-checking ${toCheck} of ${claims.length} (uncertain or below)`,
  );

  const outcomes: Array<"note" | "no_note" | "error"> = [];
  let capped = 0;
  const queue = new PQueue({ concurrency: CHECK_CONCURRENCY });
  claims.forEach((claim, i) => {
    if (!shouldFactCheck(claim.judgement)) return;
    queue.add(async () => {
      // The cap is checked before every claim, so an item can stop partway.
      // The unchecked claims stay pending and the resume path picks them up.
      if (await spendCapReached()) {
        capped++;
        return;
      }
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
    capped,
  };
}

/** Rebuilds an extracted claim from its stored row. The check path only reads
 *  the claim text and its context. The anchor fields were already saved by the
 *  original run and are never inserted again, so we leave them empty here. */
function toExtractedClaim(row: ItemClaimRow): ExtractedClaim {
  return {
    claim: row.claim,
    judgement: row.judgement,
    context: row.context_quote ?? "",
    contextParagraph: row.context_paragraph ?? "",
    imageUrls: row.image_urls ?? [],
    speculation: false,
    anchor: { kind: "substack", url: "" },
  };
}

/** Finish an item whose claims already exist because a previous run was
 *  killed while checking them. Claims that reached "note" or "no_note" are
 *  kept as they are. Claims still "pending" are checked now. Claims marked
 *  "error" are also rechecked, because on a killed run the error usually just
 *  means the check was cut off mid-flight, not that the claim is truly
 *  uncheckable. There is one special case. If a claim already has an AI note
 *  but was never marked "note", the kill landed between writing the note and
 *  updating the status. We then only fix the status, because rechecking would
 *  write a second note for the same claim. */
export async function resumeItemClaims(item: EverythingItem): Promise<ItemTally> {
  const allClaims = await fetchItemClaims(item.id);
  const redo = allClaims.filter((c) => c.status === "pending" || c.status === "error");
  const alreadyNoted = await fetchClaimIdsWithAiNotes(redo.map((c) => c.id));
  console.log(`  resuming "${item.title ?? item.url}" — redoing ${redo.length} of ${allClaims.length} claims`);

  const outcomes: Array<"note" | "no_note" | "error"> = [];
  let capped = 0;
  const queue = new PQueue({ concurrency: CHECK_CONCURRENCY });
  redo.forEach((row, i) => {
    queue.add(async () => {
      if (alreadyNoted.has(row.id)) {
        await setClaimStatus(row.id, "note", null);
        outcomes.push("note");
        return;
      }
      if (await spendCapReached()) {
        capped++;
        return;
      }
      outcomes.push(await checkAndRecordClaim(row.id, toExtractedClaim(row), item, i, item.published_at ?? undefined));
    });
  });
  await queue.onIdle();

  return {
    extracted: allClaims.length,
    speculation: 0,
    skipped: allClaims.filter((c) => c.status === "skipped").length,
    notes: outcomes.filter((o) => o === "note").length,
    no_note: outcomes.filter((o) => o === "no_note").length,
    errors: outcomes.filter((o) => o === "error").length,
    capped,
  };
}
