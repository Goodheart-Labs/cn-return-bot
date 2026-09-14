/**
 * Turns fetched content into claims and notes in the everything_* tables. The
 * queue worker calls this for every item it takes, whatever the item's source
 * is.
 *
 * Extraction first gates the item and cuts it into topic parts, then extracts
 * each part's claims. We drop the speculative ones, rate each part's claims
 * with web research, insert them all, then fact-check the ones the rater was
 * not confident about through the note pipeline and record every outcome. The
 * return value counts how many claims of this item ended in each state, which
 * the caller prints as progress.
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
import { TRIVIALLY_TRUE_JUDGEMENT, shouldFactCheck } from "./rateClaims";
import { requestClaimCheck, requestClaimExtraction, requestClaimRating } from "../../service/client";
import type { RateClaimsResponse, WorkPriority } from "../../service/contract";
import { group, money } from "../logFormat";
import { feedBudgetExhausted, requestBudgetExhausted } from "../spendCap";
import type { ContentPart, ExtractedClaim, FetchedContent, RatedClaim } from "../types";

/** How many parts of one item are rated at once. */
const RATING_PART_CONCURRENCY = 2;

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
  skipped: number; // Claims the extractor or the rater was confident are true. We do not fact-check them.
  notes: number; // Claims we fact-checked and wrote a note on.
  no_note: number; // Claims we fact-checked and found no note was needed.
  errors: number; // Claims whose fact-check threw.
  /** Claims left unchecked because the daily spend cap was reached mid-item.
   *  They stay pending in the database, and the caller puts the item back in
   *  the queue so the next day's run resumes exactly these claims. */
  capped: number;
  /** Why the intent gate declined the item, when it did. Such an item has no
   *  claims and is marked done with this reason. Null otherwise. */
  skipReason: string | null;
}

const EMPTY_TALLY: ItemTally = { extracted: 0, speculation: 0, skipped: 0, notes: 0, no_note: 0, errors: 0, capped: 0, skipReason: null };

function buildClaimRow(itemId: string, claim: RatedClaim): NewClaimRow {
  const check = shouldFactCheck(claim.judgement);
  const skipReason = claim.triviallyTrue ? "trivially true at extraction" : `judged ${claim.judgement}`;
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
    status_reason: check ? null : skipReason,
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

/** The claims of one item across all its parts, minus the speculation, the
 *  claims the item already carries, and any claim two parts both produced.
 *  The introduction is shown to every part as context, so a claim from it can
 *  come back twice despite the prompt's rule; the second copy is dropped here.
 *  Returns each part with its surviving claims, and the counts the tally
 *  reports. */
function freshClaimsPerPart(
  parts: ContentPart[],
  existingClaims: ItemClaimRow[],
): { parts: ContentPart[]; extracted: number; speculation: number; duplicates: number } {
  const norm = (text: string) => text.trim().toLowerCase();
  const seen = new Set<string>();
  let extracted = 0;
  let speculation = 0;
  let duplicates = 0;
  const fresh = parts.map((part) => {
    extracted += part.claims.length;
    const notSpeculation = dropSpeculation(part.claims);
    speculation += part.claims.length - notSpeculation.length;
    const claims = notSpeculation.filter((claim) => {
      const key = norm(claim.claim);
      const quoteKey = claim.context ? `quote:${norm(claim.context)}` : null;
      const repeated = repeatsExistingClaim(claim, existingClaims) || seen.has(key) || (quoteKey !== null && seen.has(quoteKey));
      if (repeated) duplicates++;
      seen.add(key);
      if (quoteKey) seen.add(quoteKey);
      return !repeated;
    });
    return { ...part, claims };
  });
  return { parts: fresh, extracted, speculation, duplicates };
}

/** Rates every part that still has claims, a couple of parts at a time, and
 *  sums what the rating cost. A claim the extractor marked trivially true is
 *  not sent to the rater; it comes back with the top judgement and is stored
 *  as skipped. A part with nothing left to rate is skipped, so an
 *  already-covered page does not pay for an empty research call. */
async function ratePartsOfItem(
  item: EverythingItem,
  introduction: string | null,
  parts: ContentPart[],
): Promise<{ claims: RatedClaim[]; costUsd: number | null; webSearches: number; research: string[] }> {
  const rated: RatedClaim[][] = parts.map(() => []);
  const research: string[] = [];
  let costUsd: number | null = null;
  let webSearches = 0;
  const queue = new PQueue({ concurrency: RATING_PART_CONCURRENCY });
  await Promise.all(
    parts.map((part, i) =>
      queue.add(async () => {
        const trivial = part.claims.filter((c) => c.triviallyTrue).map((c) => ({ ...c, judgement: TRIVIALLY_TRUE_JUDGEMENT }));
        const toRate = part.claims.filter((c) => !c.triviallyTrue);
        if (toRate.length === 0) {
          rated[i] = trivial;
          return;
        }
        const rating: RateClaimsResponse = await requestClaimRating({
          priority: workPriorityOf(item),
          text: part.text,
          // When there is an introduction it is the first part, and it is not
          // shown its own text as context.
          introduction: part.index === 0 ? null : introduction,
          claims: toRate,
          source: item.source,
        });
        rated[i] = [...trivial, ...rating.claims];
        if (rating.costUsd !== null) costUsd = (costUsd ?? 0) + rating.costUsd;
        webSearches += rating.webSearches;
        if (rating.research) research.push(parts.length > 1 ? `[${part.title}] ${rating.research}` : rating.research);
      }),
    ),
  );
  return { claims: rated.flat(), costUsd, webSearches, research };
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
  const extraction = await requestClaimExtraction({ priority: workPriorityOf(item), content });
  if (extraction.costUsd !== null) await insertItemRun(item.id, "extraction", extraction.costUsd);
  if (extraction.kind === "not_checkable") {
    console.log(`  not checkable: ${extraction.reason}`);
    return { ...EMPTY_TALLY, skipReason: extraction.reason };
  }
  const { parts, extracted, speculation, duplicates } = freshClaimsPerPart(extraction.parts, existingClaims);
  if (duplicates > 0) console.log(`  dropped ${duplicates} claims the item already carries`);
  if (parts.length > 1) console.log(`  ${parts.length} parts: ${parts.map((p) => p.title).join(" · ")}`);

  await setItemProgress(item.id, { stage: "rating" });
  const rating = await ratePartsOfItem(item, extraction.introduction, parts);
  if (rating.costUsd !== null) await insertItemRun(item.id, "rating", rating.costUsd);
  const claims = rating.claims;
  const claimIds = await insertClaims(claims.map((c) => buildClaimRow(item.id, c)));
  const toCheck = claims.filter((c) => shouldFactCheck(c.judgement)).length;
  await setItemProgress(item.id, { stage: "checking", total: toCheck });
  console.log(
    `  ${extracted} claims found, ${speculation} were predictions and dropped, ` +
      `${toCheck} of ${claims.length} worth checking after research (${money(rating.costUsd ?? 0)}, ${rating.webSearches} web searches)`,
  );
  const researchLog = group("research", rating.research);
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
    extracted,
    speculation,
    skipped: claims.length - toCheck,
    notes: outcomes.filter((o) => o === "note").length,
    no_note: outcomes.filter((o) => o === "no_note").length,
    errors: outcomes.filter((o) => o === "error").length,
    capped,
    skipReason: null,
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
    triviallyTrue: false,
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
    skipReason: null,
  };
}
