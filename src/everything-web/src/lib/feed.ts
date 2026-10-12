import { noteTally, probabilityHelpful, probabilityHelpfulAfter } from "@cn/core/noteBelief";
import { noteStatus, totalVotes, type NoteStatus } from "@cn/core/noteScore";
import type { FeedItemRow, NnnRow, NoteRow } from "@cn/core/types";

/* How the website's feed is put together from one project's notes. Every
 * function here is pure, so the ordering can be tested without a browser. */

/** The three vote counts a note's feed position is derived from. */
export type RankTally = Pick<NoteRow, "helpful_count" | "somewhat_helpful_count" | "not_helpful_count">;

export const tallyOf = ({ helpful_count, somewhat_helpful_count, not_helpful_count }: NoteRow): RankTally => ({
  helpful_count,
  somewhat_helpful_count,
  not_helpful_count,
});

/** Groups notes by the item their claim belongs to. */
export function notesByItem(notes: Iterable<NoteRow>): Map<string, NoteRow[]> {
  const byItem = new Map<string, NoteRow[]>();
  for (const note of notes) byItem.set(note.claim.item_id, [...(byItem.get(note.claim.item_id) ?? []), note]);
  return byItem;
}

/** The notes that improve each note, keyed by the note they improve. It is the
 *  reverse of improved_from_note_id, and the jump-links between an improvement
 *  and its original are built from it. */
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

/** The items that have notes, newest first. The item links and the feed both
 *  read this list. */
export function itemsWithNotes(items: Iterable<FeedItemRow>, byItem: Map<string, NoteRow[]>): FeedItemRow[] {
  const published = (i: FeedItemRow) => i.published_at ?? i.created_at;
  return [...items].filter((i) => byItem.has(i.id)).sort((a, b) => published(b).localeCompare(published(a)));
}

/** The age of the note an improvement chain starts from. */
function rootCreatedAt(note: NoteRow, notesById: ReadonlyMap<string, NoteRow>): string {
  let current = note;
  const seen = new Set<string>();
  while (current.improved_from_note_id && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = notesById.get(current.improved_from_note_id);
    if (!parent) break;
    current = parent;
  }
  return current.created_at;
}

/** Puts the notes of the given items in content order: the newest item first,
 *  and inside an item the order of the content itself, by clip timestamp.
 *  Notes on the same claim share one timestamp, so an improvement chain is
 *  kept behind the note it descends from: ties break on the age of the chain's
 *  root note, then originals come before improvements, then the older note
 *  first. The result is deterministic, which the ranking below relies on. */
export function contentOrder(items: FeedItemRow[], byItem: Map<string, NoteRow[]>, notesById: ReadonlyMap<string, NoteRow>): NoteRow[] {
  return items.flatMap((item) =>
    [...(byItem.get(item.id) ?? [])].sort(
      (a, b) =>
        (a.claim.start_seconds ?? 0) - (b.claim.start_seconds ?? 0) ||
        rootCreatedAt(a, notesById).localeCompare(rootCreatedAt(b, notesById)) ||
        Number(!!a.improved_from_note_id) - Number(!!b.improved_from_note_id) ||
        a.created_at.localeCompare(b.created_at),
    ),
  );
}

/** How many of the most helpful notes lead the feed before notes that need
 *  ratings are mixed in. */
const LEADING_HELPFUL_NOTES = 3;

/** Leads with the strongest helpful notes, then alternates one note that needs
 *  ratings with one more helpful note, starting with a note that needs ratings.
 *  When either list runs out, the rest of the other follows in order. */
export function mergeFeedNotes<T>(helpful: readonly T[], needRatings: readonly T[]): T[] {
  const merged = helpful.slice(0, LEADING_HELPFUL_NOTES);
  for (let i = 0; i < Math.max(needRatings.length, helpful.length - LEADING_HELPFUL_NOTES); i++) {
    if (i < needRatings.length) merged.push(needRatings[i]!);
    if (i + LEADING_HELPFUL_NOTES < helpful.length) merged.push(helpful[i + LEADING_HELPFUL_NOTES]!);
  }
  return merged;
}

/** The feed's three bands. `leading` is the helpful notes mixed with the notes
 *  that need ratings. The other two sit below their own divider. */
export interface FeedSections {
  leading: NoteRow[];
  unhelpful: NoteRow[];
  staleSource: NoteRow[];
}

interface RankInputs {
  status: NoteStatus;
  p: number;
  pAfterOneHelpful: number;
  votes: number;
  contentIndex: number;
}

/** Ranks notes that are already in content order.
 *
 *  `rankTally` gives the vote counts each note is ranked by. The feed passes
 *  the counts a note had when it first appeared, so no card moves under a
 *  reader who just voted on it; the card itself still shows the live counts.
 *
 *  A note whose source text has since been edited drops below everything
 *  else, whatever its rating, because it may no longer apply. Of the rest, the
 *  helpful notes sort by the chance they stay helpful, then by more votes. The
 *  notes that need ratings sort by how far one more Helpful vote would push
 *  them, oldest first on a tie, because that is where a rating settles the
 *  most. Unhelpful and stale notes sort by that chance, best first. Content
 *  order breaks every remaining tie. */
export function rankFeed(ordered: NoteRow[], rankTally: (note: NoteRow) => RankTally): FeedSections {
  // Computing p evaluates a continued fraction, so each note's inputs are
  // derived once here rather than inside the comparators.
  const inputs = new Map<string, RankInputs>(
    ordered.map((note, contentIndex) => {
      const ranked = { ...note, ...rankTally(note) };
      return [note.id, {
        status: noteStatus(ranked),
        p: probabilityHelpful(noteTally(ranked)),
        pAfterOneHelpful: probabilityHelpfulAfter(ranked, 1),
        votes: totalVotes(ranked),
        contentIndex,
      }];
    }),
  );
  const of = (note: NoteRow) => inputs.get(note.id)!;
  const byContent = (a: NoteRow, b: NoteRow) => of(a).contentIndex - of(b).contentIndex;
  const bestFirst = (a: NoteRow, b: NoteRow) => of(b).p - of(a).p || byContent(a, b);

  const stale = (note: NoteRow) => note.claim.updated_quote != null;
  const current = ordered.filter((note) => !stale(note));
  const withStatus = (status: NoteStatus) => current.filter((note) => of(note).status === status);

  const helpful = withStatus("helpful").sort((a, b) => of(b).p - of(a).p || of(b).votes - of(a).votes || byContent(a, b));
  const needRatings = withStatus("needs_ratings").sort(
    (a, b) => of(b).pAfterOneHelpful - of(a).pAfterOneHelpful || a.created_at.localeCompare(b.created_at) || byContent(a, b),
  );
  return {
    leading: mergeFeedNotes(helpful, needRatings),
    unhelpful: withStatus("not_helpful").sort(bestFirst),
    staleSource: ordered.filter(stale).sort(bestFirst),
  };
}
