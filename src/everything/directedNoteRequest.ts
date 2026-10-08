import { getSupabaseClient } from "../api/supabaseClient";
import { requestClaimCheck } from "../service/client";
import { buildClaimPost, recordClaimRun } from "./pipeline/checkClaims";
import { insertClaims, insertNote, raiseItemPriority, requeueItem, resolveNoteRequest, setClaimStatus, type NoteRequestRow } from "./db";
import { requestBudgetExhausted } from "./spendCap";
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
  const passage = request.selection || request.page_text || item.full_text;
  if (!passage) throw new Error("No passage to check");
  const { data: claimed, error: claimError } = await db.from("everything_note_requests")
    .update({ status: "enqueued", item_id: item.id }).eq("id", request.id).eq("status", "pending").select("id").maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { kind: "deferred", detail: "another consumer took the request" };
  const claim: ExtractedClaim = {
    claim: passage, context: passage, contextParagraph: passage, steer: request.steer,
    imageUrls: [], anchor: { kind: "substack", url: request.page_url },
  };
  const [claimId] = await insertClaims([{
    item_id: item.id, claim: passage, judgement: "uncertain", context_quote: passage, context_paragraph: passage,
    image_urls: [], context_url: request.page_url, start_seconds: null, end_seconds: null, status: "pending", status_reason: null,
  }]);
  try {
    const { check, run } = await requestClaimCheck({ priority: "reader", post: buildClaimPost({ claim, source: item.source as ItemSource, itemId: item.id, index: 0, publishedAt: item.published_at ?? undefined }) });
    await recordClaimRun(claimId!, run, "reader");
    if (check.kind === "note") await insertNote(claimId!, check.note, check.sources);
    await setClaimStatus(claimId!, check.kind, check.kind === "no_note" ? check.reason : null);
    await resolveNoteRequest(request.id, "done", null, item.id);
  } catch (err) {
    await setClaimStatus(claimId!, "error", "Requested check failed");
    throw err;
  }
  return { kind: "queued", detail: `checked requested passage: ${request.page_url}` };
}
