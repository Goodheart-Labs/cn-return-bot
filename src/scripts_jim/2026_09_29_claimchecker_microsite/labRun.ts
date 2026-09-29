/**
 * The shapes the claimchecker lab stores on disk.
 *
 * A "lab run" is one pass of the pipeline over the article, saved as one JSON
 * file under site/public/runs/. The production run is saved in the same shape,
 * so the microsite shows both the same way. This file is shared with the
 * microsite, so it must not touch the disk; runStore.ts does that.
 */

export interface Article {
  url: string;
  snapshotUrl: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  publishedAt: string | null;
  /** The post's own markup, cleaned of Substack's buttons and class names. */
  html: string;
  /** The plain text with [[IMAGE:url]] markers that the pipeline reads. */
  text: string;
}

/** What happened to one claim. `skipped` means the rater, or the extractor,
 *  was confident enough that the claim is true that it was never fact-checked.
 *  `unchecked` means the production run never got to it. */
export type ClaimOutcome =
  | { type: "note" }
  | { type: "no_note"; reason: string }
  | { type: "skipped"; reason: string }
  | { type: "error"; error: string }
  | { type: "unchecked" };

export interface LabSource {
  url: string;
  quote: string | null;
  explanation: string | null;
}

export interface LabVotes {
  helpful: number;
  somewhatHelpful: number;
  notHelpful: number;
}

export interface LabNote {
  id: string;
  text: string;
  /** Null on a note the pipeline wrote, a display name on a reader's note. */
  author: string | null;
  isAi: boolean;
  sources: LabSource[];
  votes: LabVotes;
  status: "published" | "draft" | "hidden";
  createdAt: string;
  improvedFromNoteId: string | null;
}

/** A reader's argument that the claim needs no note. Only production has them. */
export interface LabNotNeeded {
  id: string;
  body: string;
  author: string | null;
  votes: LabVotes;
}

export interface LabClaim {
  id: string;
  claim: string;
  contextQuote: string | null;
  contextParagraph: string | null;
  imageUrls: string[];
  /** The rater's verdict on the seven-level scale, or "user" for a claim a
   *  reader created by writing a note on a passage. */
  judgement: string;
  /** The topic part the claim was extracted from. Production does not store it. */
  part: string | null;
  outcome: ClaimOutcome;
  notes: LabNote[];
  notNeeded: LabNotNeeded[];
  checkCostUsd: number | null;
}

export type Stage = "extraction" | "rating";

export interface LabRun {
  id: string;
  label: string;
  createdAt: string;
  source: "local" | "production";
  /** The commit the pipeline code was at when the run started. */
  commit: string | null;
  /** The earlier run whose extraction, or extraction and rating, this run
   *  started from instead of redoing them. */
  basedOn: { runId: string; reused: Stage[] } | null;
  /** What each step cost. A reused step carries the cost it had in the run
   *  it came from, so the total is what one full pass would cost. */
  costUsd: { extraction: number | null; rating: number | null; checks: number | null };
  claims: LabClaim[];
}

/** One line of the run picker, so the microsite does not have to load every
 *  run to list them. */
export interface RunIndexEntry {
  id: string;
  label: string;
  createdAt: string;
  source: LabRun["source"];
  totalCostUsd: number;
  claims: number;
  notes: number;
}

export function totalCost(run: LabRun): number {
  const { extraction, rating, checks } = run.costUsd;
  return (extraction ?? 0) + (rating ?? 0) + (checks ?? 0);
}

export function indexEntryOf(run: LabRun): RunIndexEntry {
  return {
    id: run.id,
    label: run.label,
    createdAt: run.createdAt,
    source: run.source,
    totalCostUsd: totalCost(run),
    claims: run.claims.length,
    notes: run.claims.reduce((n, c) => n + c.notes.length, 0),
  };
}
