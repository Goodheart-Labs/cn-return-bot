/* The pipeline posts each note through API v1's add_note, as the notewriter
 * `pipeline` (GOO-791), so its notes get the same checks as every other
 * notewriter's. The note hangs on the pipeline's own claim, whose quote and
 * timings add_note reads. The pipeline holds the post's reservation while it
 * checks, which add_note needs. */

import { PIPELINE_NOTEWRITER } from "../../notewriters/ids";
import { addNote, type AddedNote } from "../../notewriters/v1";
import type { NoteSourceCitation } from "../types";

/** A note takes at most this many sources. The pipeline's writer may cite
 *  more, and the first ones are kept. */
const MAX_NOTE_SOURCES = 8;

export function postClaimNote(itemId: string, claimId: string, check: { note: string; sources: NoteSourceCitation[] }): Promise<AddedNote> {
  return addNote(PIPELINE_NOTEWRITER, itemId, {
    claim: claimId,
    passage: "",
    note: check.note,
    sources: check.sources.slice(0, MAX_NOTE_SOURCES).map((s) => ({ url: s.url, quote: s.quote ?? undefined, explanation: s.explanation ?? undefined })),
  });
}
