import type { FeedBand, FeedSummary, NoteFilters, NoteMinimums } from "@cn/core/feedPages";
import type { NnnRow, NoteRow } from "@cn/core/types";

/* What the browser still decides about a notes feed. The database ranks and
 * filters the notes and sends them a page at a time (migration 139). The
 * browser groups the loaded notes into the bands the reader sees, labels them,
 * and links related notes. Every function here is pure, so it can be tested
 * without a browser. */

/** The notes that improve each note, keyed by the note they improve. It is the
 *  reverse of improved_from_note_id, and the jump-links between an improvement
 *  and its original are built from it. Only notes that have loaded are known,
 *  so an improvement further down the feed gets its link once its page loads. */
export function improvementsByOriginal(notes: Iterable<NoteRow>): Map<string, NoteRow[]> {
  const byOriginal = new Map<string, NoteRow[]>();
  for (const note of notes) {
    const original = note.improved_from_note_id;
    if (original) byOriginal.set(original, [...(byOriginal.get(original) ?? []), note]);
  }
  return byOriginal;
}

/** Each claim's note-not-needed entries, oldest first. They are ordered by age
 *  and not by votes, so an entry never jumps position while the reader looks
 *  at it. The same list renders under every note on that claim. */
export function entriesByClaim(entries: Iterable<NnnRow>): Map<string, NnnRow[]> {
  const byClaim = new Map<string, NnnRow[]>();
  const oldestFirst = [...entries].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const entry of oldestFirst) byClaim.set(entry.claim_id, [...(byClaim.get(entry.claim_id) ?? []), entry]);
  return byClaim;
}

/** One band of the feed. A band with a label sits below a divider that names
 *  it and says how many notes the whole band holds, loaded or not. A band
 *  without a label, such as the start of the mixed feed, has no divider. */
export interface FeedSection<T> {
  label: string | null;
  total: number | null;
  entries: T[];
}

/** Groups entries that are already in feed order into bands. Entries next to
 *  each other with the same label share a band. */
export function sectionsOf<T>(entries: T[], labelOf: (entry: T) => string | null, totalOf: (label: string) => number | null): FeedSection<T>[] {
  const sections: FeedSection<T>[] = [];
  for (const entry of entries) {
    const label = labelOf(entry);
    const last = sections.at(-1);
    if (last && last.label === label) last.entries.push(entry);
    else sections.push({ label, total: label === null ? null : totalOf(label), entries: [entry] });
  }
  return sections;
}

/** The divider labels of the mixed order's bands. The main band has none. */
export const BAND_LABELS: Record<FeedBand, string | null> = {
  main: null,
  all: null,
  unhelpful: "Unhelpful notes",
  stale: "Source has since changed",
};

/** How many notes the mixed order's band with this label holds. */
export function bandTotal(summary: FeedSummary | undefined, label: string): number | null {
  if (!summary) return null;
  if (label === BAND_LABELS.unhelpful) return summary.bands.unhelpful;
  if (label === BAND_LABELS.stale) return summary.bands.stale;
  return null;
}

/** The spans of time the Newest order puts a divider between, newest first.
 *  Each span starts at midnight in the reader's time zone, a whole number of
 *  days back, and ends where the span before it starts. "Last 7 days" covers
 *  today and the 6 days before it, so after Today and Yesterday it holds the
 *  5 days before those. "Older" is everything before the last 365 days. */
const AGE_SPANS: { label: string; daysBack: number }[] = [
  { label: "Today", daysBack: 0 },
  { label: "Yesterday", daysBack: 1 },
  { label: "Last 7 days", daysBack: 6 },
  { label: "Last 30 days", daysBack: 29 },
  { label: "Last 365 days", daysBack: 364 },
  { label: "Older", daysBack: Infinity },
];

/** Midnight at the start of the day `daysBack` days before `now`, in the
 *  reader's time zone. */
const startOfDay = (now: Date, daysBack: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack);

/** The moments the spans of the Newest order start, newest first, without the
 *  open-ended "Older". The feed's summary counts the notes since each. */
export const spanStarts = (now: Date): Date[] => AGE_SPANS.filter((span) => Number.isFinite(span.daysBack)).map((span) => startOfDay(now, span.daysBack));

/** The label of the span a note created at `createdAt` falls in. */
export function ageLabel(createdAt: string, starts: Date[]): string {
  const created = new Date(createdAt).getTime();
  const index = starts.findIndex((start) => created >= start.getTime());
  return AGE_SPANS[index === -1 ? starts.length : index]!.label;
}

/** How many matching notes the span with this label holds. The summary counts
 *  the notes since each start, so a span is the difference of two counts. */
export function ageTotal(summary: FeedSummary | undefined, label: string): number | null {
  if (!summary) return null;
  const index = AGE_SPANS.findIndex((span) => span.label === label);
  const since = (i: number) => (i < 0 ? 0 : i < summary.since.length ? summary.since[i]! : summary.matching);
  return since(index) - since(index - 1);
}

export const MINIMUM_KEYS: (keyof NoteMinimums)[] = ["views", "votes", "helpful", "notHelpful"];

/** Notes on posts that at least a few real readers saw come first by default,
 *  because a vote on those improves what people actually read. Notes the reader
 *  already voted on are hidden by default, so the feed shows what still needs
 *  their vote. */
export const DEFAULT_NOTE_FILTERS: NoteFilters = { views: 5, votes: 0, helpful: 0, notHelpful: 0, unvotedOnly: true };
