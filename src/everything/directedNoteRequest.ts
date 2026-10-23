import { getSupabaseClient } from "../api/supabaseClient";
import { requestClaimCheck } from "../service/client";
import { buildClaimPost, recordClaimRun } from "./pipeline/checkClaims";
import { insertClaims, insertNote, raiseItemPriority, requeueItem, resolveNoteRequest, setClaimStatus, type NoteRequestRow } from "./db";
import { requestBudgetExhausted } from "./spendCap";
import { paragraphAround } from "./selectionParagraph";
import { PASSAGE_CHECK } from "../everything-core/requestProgress";
import type { NoteRequestOutcome } from "./consumeRequests";
import type { ExtractedClaim, ItemSource } from "./types";

export async function consumeDirectedNoteRequest(request: NoteRequestRow, existing: { id: string; status: string }): Promise<NoteRequestOutcome> {
  if (existing.status === "processing" || existing.status === "queued") return { kind: "deferred", detail: "waiting for the article check" };
  if (existing.status === "error") {
    await requeueItem(existing.id);
    await raiseItemPriority(existing.id, 2);
    return { kind: "deferred", detail: "retrying the article check first" };
  }
  if (await requestBudgetExhausted()) throw new Error("Daily budget reached");
  const db = getSupabaseClient();
  const { data: item, error } = await db.from("everything_items").select("id, source, full_text, published_at").eq("id", existing.id).single();
  if (error) throw error;
  // The item's text is the article the whole-page check read. The extension's
  // raw capture also holds comments and sidebars, so it is only the fallback.
  const page = item.full_text || request.page_text;
  const passage = request.selection || page;
  if (!passage) throw new Error("No passage to check");
  const paragraph = request.selection && page ? paragraphAround(page, request.selection) : passage;
  const { data: claimed, error: claimError } = await db.from("everything_note_requests")
    .update({ status: "enqueued", status_reason: PASSAGE_CHECK.running, item_id: item.id }).eq("id", request.id).eq("status", "pending").select("id").maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { kind: "deferred", detail: "another consumer took the request" };
  const claim: ExtractedClaim = {
    claim: passage, context: passage, contextParagraph: paragraph, steer: request.steer,
    imageUrls: [], page: request.selection ? page : null, anchor: { kind: "substack", url: request.page_url },
  };
  const [claimId] = await insertClaims([{
    item_id: item.id, claim: passage, judgement: "uncertain", context_quote: passage, context_paragraph: paragraph,
    image_urls: [], context_url: request.page_url, start_seconds: null, end_seconds: null, status: "pending", status_reason: null,
  }]);
  try {
    const { check, run } = await requestClaimCheck({ priority: "reader", post: buildClaimPost({ claim, source: item.source as ItemSource, itemId: item.id, index: 0, publishedAt: item.published_at ?? undefined }) });
    await recordClaimRun(claimId!, run, "reader");
    if (check.kind === "note") await insertNote(claimId!, check.note, check.sources);
    await setClaimStatus(claimId!, check.kind, check.kind === "no_note" ? check.reason : null);
    await resolveNoteRequest(request.id, "done", check.kind === "note" ? PASSAGE_CHECK.note : PASSAGE_CHECK.noNote, item.id);
  } catch (err) {
    await setClaimStatus(claimId!, "error", "Requested check failed");
    throw err;
  }
  return { kind: "queued", detail: `checked requested passage: ${request.page_url}` };
}
