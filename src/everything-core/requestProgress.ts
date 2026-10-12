/** The pure model behind the live-progress card. The extension watches the
 *  request row and the item behind it, and everything shown on screen is
 *  derived from those rows by deriveRequestProgress. Nothing here touches the
 *  network, so the mapping is unit-testable and the popup and the in-page card
 *  cannot drift apart. */

/** The live stage a worker stamps on an item (migration 087). It is only
 *  written at stage boundaries and is null while the item is idle or after it
 *  finished. */
export type ItemProgressStage =
  | { stage: "extracting" }
  | { stage: "rating" }
  | { stage: "checking"; total: number }
  | { stage: "budget_exhausted" };

/** The narrow slice of an everything_items row the progress card reads. Never
 *  fetch more than this: the full row can carry 500 KB of body text. */
export interface ProgressItemRow {
  id: string;
  status: "queued" | "processing" | "done" | "error";
  checked_scope?: "page" | "paragraph" | null;
  progress: ItemProgressStage | null;
}

/** The narrow slice of an everything_claims row the progress card reads. */
export interface ProgressClaimRow {
  id: string;
  status: "pending" | "skipped" | "no_note" | "note" | "error";
}

/** One row from the everything_request_status(token) lookup. item_id is null
 *  until the intake turned the request into a queue item. */
export interface RequestStatusRow {
  status: "pending" | "enqueued" | "done" | "skipped" | "error";
  status_reason: string | null;
  item_id: string | null;
}

/** Every state the card can display.
 *  - "saved" is a request the intake has not picked up yet.
 *  - "queued" is an item waiting for a worker.
 *  - "budget" is a queued item that cannot run because even the reserved
 *    request budget is spent for the day.
 *  - "checking" carries the running tallies; "done" only the note count.
 *  - "unavailable" means we cannot watch at all, for example against a backend
 *    that predates the status lookup. The request itself was still saved. */
export type RequestProgress =
  | { kind: "saved" }
  | { kind: "queued" }
  | { kind: "budget" }
  | { kind: "extracting" }
  // Rating is the research pass that filters the extracted claims down to the
  // ones worth a fact-check. The readout calls it filtering, because that is
  // what a reader sees it do.
  | { kind: "rating" }
  | { kind: "checking"; done: number; total: number; notes: number }
  | { kind: "done"; notes: number }
  | { kind: "failed" }
  | { kind: "unavailable" };

/** Whether a state can still change. The watcher tears itself down on a
 *  terminal state, and the stored live-request entry is removed. A budget
 *  state is deliberately not terminal: the item is still queued and will run
 *  once the budget resets, so a revisit should keep watching it. */
export function progressIsTerminal(progress: RequestProgress): boolean {
  return progress.kind === "done" || progress.kind === "failed" || progress.kind === "unavailable";
}

/** A claim that has been through its check. A skipped claim never gets
 *  checked, so it does not count as finished and does not count toward the
 *  displayed total either; both tallies then move over the same set. */
function isFinishedClaim(claim: ProgressClaimRow): boolean {
  return claim.status === "note" || claim.status === "no_note" || claim.status === "error";
}

function checkingCounts(item: ProgressItemRow, claims: ProgressClaimRow[]): RequestProgress {
  const countable = claims.filter((c) => c.status !== "skipped");
  const done = countable.filter(isFinishedClaim).length;
  // The stamped total is what the worker set out to check. The claim rows can
  // briefly outnumber it while rows land, so the larger of the two keeps the
  // fraction from reading as more than complete.
  const stamped = item.progress?.stage === "checking" ? item.progress.total : 0;
  const total = Math.max(stamped, countable.length);
  return { kind: "checking", done, total, notes: claims.filter((c) => c.status === "note").length };
}

/** Maps the rows we can see to the state the card shows. Any of the three
 *  inputs can be missing: right after submitting there is no item yet, and
 *  against an old backend the request lookup answers nothing. */
export function deriveRequestProgress(
  item: ProgressItemRow | null,
  claims: ProgressClaimRow[],
  request: RequestStatusRow | null,
): RequestProgress {
  if (!item) {
    if (!request) return { kind: "unavailable" };
    if (request.status === "error" || request.status === "skipped") return { kind: "failed" };
    // The request is pending, or it was resolved but the item row has not
    // reached us yet. Either way the reader is waiting.
    return { kind: "saved" };
  }
  if (item.status === "queued") {
    if (item.progress?.stage === "budget_exhausted") return { kind: "budget" };
    return { kind: "queued" };
  }
  if (item.status === "processing") {
    if (item.progress?.stage === "extracting") return { kind: "extracting" };
    if (item.progress?.stage === "rating") return { kind: "rating" };
    if (item.progress?.stage === "checking" || claims.length > 0) return checkingCounts(item, claims);
    // The worker holds the item but has stamped no stage yet, so it is still
    // reading the page. Extraction is what begins next, and showing that reads
    // better than a silent gap.
    return { kind: "extracting" };
  }
  if (item.status === "done") {
    return { kind: "done", notes: claims.filter((c) => c.status === "note").length };
  }
  // The item errored. The pipeline requeues errored requested items, so the
  // wording promises a retry.
  return { kind: "failed" };
}

function notesLine(notes: number): string {
  return notes === 1 ? "1 note written" : `${notes} notes written`;
}

/** The terse readout, one fact per line. These are the only strings the card
 *  and the popup ever show, so the two surfaces always read the same. */
export function progressLines(progress: RequestProgress): string[] {
  switch (progress.kind) {
    case "saved":
    case "queued":
      return ["waiting in line"];
    case "budget":
      return ["today's checking budget is used up"];
    case "extracting":
      return ["extracting claims ..."];
    case "rating":
      return ["filtering claims ..."];
    case "checking": {
      const lines = [`${progress.done} of ${progress.total} claims checked`];
      if (progress.notes > 0) lines.push(notesLine(progress.notes));
      return lines;
    }
    case "done":
      return [progress.notes > 0 ? notesLine(progress.notes) : "checked, nothing to note"];
    case "failed":
      return ["failed, will retry"];
    case "unavailable":
      return ["live progress unavailable"];
  }
}
