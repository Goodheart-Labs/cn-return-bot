import { requestClaimCheck } from "../../service/client";
import { insertClaims, setClaimStatus, type EverythingItem } from "../db";
import type { PassageRequest } from "../passageRequests";
import { paragraphAround } from "../selectionParagraph";
import type { ExtractedClaim } from "../types";
import { buildClaimPost, recordClaimRun } from "./checkClaims";
import { postClaimNote } from "./postNote";

/** The pipeline's check of one passage a reader asked about. The passage is
 *  checked as one claim, with the paragraph around it and the reader's reason.
 *  Returns whether it got a note. */
export async function checkRequestedPassage(item: EverythingItem, request: PassageRequest): Promise<boolean> {
  const page = item.full_text;
  const paragraph = page ? paragraphAround(page, request.passage) : request.passage;
  const claim: ExtractedClaim = {
    claim: request.passage, context: request.passage, contextParagraph: paragraph, steer: request.reason,
    imageUrls: [], page, anchor: { kind: "substack", url: item.url },
  };
  const [claimId] = await insertClaims([{
    item_id: item.id, claim: request.passage, judgement: "uncertain", context_quote: request.passage, context_paragraph: paragraph,
    image_urls: [], context_url: item.url, start_seconds: null, end_seconds: null, status: "pending", status_reason: null,
  }]);
  try {
    const { check, run } = await requestClaimCheck({ priority: "reader", post: buildClaimPost({ claim, source: item.source, itemId: item.id, index: 0, publishedAt: item.published_at ?? undefined }) });
    await recordClaimRun(claimId!, run, "reader");
    if (check.kind === "no_note") {
      await setClaimStatus(claimId!, "no_note", check.reason);
      return false;
    }
    const posted = await postClaimNote(item.id, claimId!, check);
    await setClaimStatus(claimId!, posted.kind === "posted" ? "note" : "no_note", posted.kind === "posted" ? null : posted.reason);
    return posted.kind === "posted";
  } catch (err) {
    await setClaimStatus(claimId!, "error", "Requested check failed");
    throw err;
  }
}
