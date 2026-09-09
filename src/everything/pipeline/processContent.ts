/**
 * Turns fetched content into claims and notes in the everything_* tables. The
 * queue worker calls this for every item it takes, whatever the item's source
 * is.
 *
 * We extract the claims, drop the speculative ones, rate them with web
 * research, insert them, then fact-check the ones the rater was not confident
 * about through the note pipeline and record every outcome. The return value counts how many claims of this
 * item ended in each state, which the caller prints as progress.
 */

import PQueue from "p-queue";
import { buildClaimPost, recordClaimRun } from "./checkClaims";
import {
  QUEUE_PRIORITY,
  fetchClaimIdsWithAiNotes,
  fetchItemClaims,
  insertClaims,
  insertNote,
  isSyntheticDocUrl,
  setClaimStatus,
  updateItemMeta,
  type EverythingItem,
  insertItemRun,
  setItemProgress,
  type ItemClaimRow,
  type NewClaimRow,
} from "../db";
import { dropSpeculation } from "./extractClaims";
import { shouldFactCheck } from "./rateClaims";
import { requestClaimCheck, requestClaimExtraction, requestClaimRating } from "../../service/client";
import type { RateClaimsResponse, WorkPriority } from "../../service/contract";
import { group, money } from "../logFormat";
import { feedBudgetExhausted, requestBudgetExhausted } from "../spendCap";
import type { ExtractedClaim, FetchedContent, RatedClaim } from "../types";

/** How many claims of one item are in flight at once. The services decide the
 *  real capacity, so this is not a capacity limit. It paces the work so the
 *  daily spend cap is still consulted as the item progresses, which is what
 *  lets an item stop partway and resume later. */
const CHECK_REQUEST_CONCURRENCY = 6;

/** A page someone asked for and is waiting on is served before anything from
 *  the backlog. Everything else this file processes is backlog. */
function workPriorityOf(item: EverythingItem): WorkPriority {
  return item.priority >= QUEUE_PRIORITY.requested ? "reader" : "feed";
}

/** Which budget this item's claims spend from. Reader-requested work may use
 *  the reserve; everything else stops earlier, at the cap minus the reserve. */
function budgetExhaustedFor(item: EverythingItem): Promise<boolean> {
  return workPriorityOf(item) === "reader" ? requestBudgetExhausted() : feedBudgetExhausted();
}

/** Where every extracted claim ended up, for one item. */
export interface ItemTally {
  extracted: number;
  speculation: number; // Claims about a future scenario. We drop them before inserting.
  skipped: number; // Claims the rater was confident are true. We do not fact-check them.
  notes: number; // Claims we fact-checked and wrote a note on.
  no_note: number; // Claims we fact-checked and found no note was needed.
  errors: number; // Claims whose fact-check threw.
  /** Claims left unchecked because the daily spend cap was reached mid-item.
   *  They stay pending in the database, and the caller puts the item back in
   *  the queue so the next day's run resumes exactly these claims. */
  capped: number;
}

function buildClaimRow(itemId: string, claim: RatedClaim): NewClaimRow {
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
  lines: string[],
): Promise<"note" | "no_note" | "error"> {
  try {
    const { check, run } = await requestClaimCheck({
      priority: workPriorityOf(item),
      post: buildClaimPost({ claim, source: item.source, itemId: item.id, index, publishedAt }),
    });
    // The service cannot store anything, so recording the run is ours to do.
    await recordClaimRun(claimId, run);
    if (check.kind === "note") {
      await insertNote(claimId, check.note, check.sources);
      await setClaimStatus(claimId, "note", null);
      lines.push(`     ⚠️  NOTE — ${claim.claim}\n         ${check.note}`);
      return "note";
    }
    await setClaimStatus(claimId, "no_note", check.reason ?? check.outcome);
    lines.push(`     ✅ no note (${check.reason ?? check.outcome}) — ${claim.claim}`);
    return "no_note";
  } catch (err: any) {
    await setClaimStatus(claimId, "error", err?.message ?? "unknown");
    lines.push(`     ❌ error — ${claim.claim}: ${err?.message}`);
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

  await setItemProgress(item.id, { stage: "extracting" });
  const { claims: extracted, costUsd } = await requestClaimExtraction({ priority: workPriorityOf(item), content });
  if (costUsd !== null) await insertItemRun(item.id, "extraction", costUsd);
  const fresh = dropSpeculation(extracted);
  const duplicates = fresh.filter((c) => repeatsExistingClaim(c, existingClaims)).length;
  if (duplicates > 0) console.log(`  dropped ${duplicates} claims the item already carries`);
  const speculation = extracted.length - fresh.length;
  const newClaims = fresh.filter((c) => !repeatsExistingClaim(c, existingClaims));

  // The rating call is skipped for an item with nothing new to rate, so an
  // already-covered page does not pay for an empty research call.
  await setItemProgress(item.id, { stage: "rating" });
  const rating: RateClaimsResponse = newClaims.length
    ? await requestClaimRating({ priority: workPriorityOf(item), text: bodyText(content), claims: newClaims, source: item.source })
    : { claims: [], research: "", webSearches: 0, costUsd: null };
  if (rating.costUsd !== null) await insertItemRun(item.id, "rating", rating.costUsd);
  const claims = rating.claims;
  const claimIds = await insertClaims(claims.map((c) => buildClaimRow(item.id, c)));
  const toCheck = claims.filter((c) => shouldFactCheck(c.judgement)).length;
  await setItemProgress(item.id, { stage: "checking", total: toCheck });
  console.log(
    `  ${extracted.length} claims found, ${speculation} were predictions and dropped, ` +
      `${toCheck} of ${claims.length} worth checking after research (${money(rating.costUsd ?? 0)}, ${rating.webSearches} web searches)`,
  );
  const researchLog = group("research", [rating.research]);
  if (researchLog) console.log(researchLog);

  const outcomes: Array<"note" | "no_note" | "error"> = [];
  // Each claim's verdict is collected rather than printed as it lands, so the
  // whole block can be shown as one collapsible section. A long item can carry
  // dozens of these and they used to bury everything else in the run.
  const claimLines: string[] = [];
  let capped = 0;
  const queue = new PQueue({ concurrency: CHECK_REQUEST_CONCURRENCY });
  claims.forEach((claim, i) => {
    if (!shouldFactCheck(claim.judgement)) return;
    queue.add(async () => {
      // The cap is checked before every claim, so an item can stop partway.
      // The unchecked claims stay pending and the resume path picks them up.
      if (await budgetExhaustedFor(item)) {
        capped++;
        return;
      }
      outcomes.push(await checkAndRecordClaim(claimIds[i]!, claim, item, i, content.publishedAt, claimLines));
    });
  });
  await queue.onIdle();
  const checksLog = group(`all ${claimLines.length} checks`, claimLines);
  if (checksLog) console.log(checksLog);

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
  await setItemProgress(item.id, { stage: "checking", total: redo.length });
  const alreadyNoted = await fetchClaimIdsWithAiNotes(redo.map((c) => c.id));
  console.log(`  resuming "${item.title ?? item.url}" — redoing ${redo.length} of ${allClaims.length} claims`);

  const outcomes: Array<"note" | "no_note" | "error"> = [];
  // Each claim's verdict is collected rather than printed as it lands, so the
  // whole block can be shown as one collapsible section. A long item can carry
  // dozens of these and they used to bury everything else in the run.
  const claimLines: string[] = [];
  let capped = 0;
  const queue = new PQueue({ concurrency: CHECK_REQUEST_CONCURRENCY });
  redo.forEach((row, i) => {
    queue.add(async () => {
      if (alreadyNoted.has(row.id)) {
        await setClaimStatus(row.id, "note", null);
        outcomes.push("note");
        return;
      }
      if (await budgetExhaustedFor(item)) {
        capped++;
        return;
      }
      outcomes.push(await checkAndRecordClaim(row.id, toExtractedClaim(row), item, i, item.published_at ?? undefined, claimLines));
    });
  });
  await queue.onIdle();
  const resumedLog = group(`all ${claimLines.length} checks`, claimLines);
  if (resumedLog) console.log(resumedLog);

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
