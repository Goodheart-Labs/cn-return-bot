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

/** One band of the feed. A band with a label sits below a divider that names
 *  it. A band without one, such as the start of the mixed feed, has none. */
export interface FeedSection {
  label: string | null;
  notes: NoteRow[];
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
export function rankFeed(ordered: NoteRow[], rankTally: (note: NoteRow) => RankTally): FeedSection[] {
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
  return [
    { label: null, notes: mergeFeedNotes(helpful, needRatings) },
    { label: "Unhelpful notes", notes: withStatus("not_helpful").sort(bestFirst) },
    { label: "Source has since changed", notes: ordered.filter(stale).sort(bestFirst) },
  ];
}

/** The orders a reader can pick on the All notes page. `mixed` is the order
 *  every project's own page uses. */
export type FeedOrder = "mixed" | "recent" | "helpful";

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
 *  reader's time zone, as milliseconds. Infinitely many days back is the
 *  start of time. */
function startOfDay(now: Date, daysBack: number): number {
  return Number.isFinite(daysBack) ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack).getTime() : -Infinity;
}

/** Splits notes that are already newest first into one band per span of time.
 *  A span with no notes gets an empty band, which the feed does not render. */
function sectionsByAge(newest: NoteRow[], now: Date): FeedSection[] {
  const sections = AGE_SPANS.map(({ label }) => ({ label, notes: [] as NoteRow[] }));
  const starts = AGE_SPANS.map(({ daysBack }) => startOfDay(now, daysBack));
  for (const note of newest) {
    const created = new Date(note.created_at).getTime();
    sections[starts.findIndex((start) => created >= start)]!.notes.push(note);
  }
  return sections;
}

/** Every note, newest first. Content order breaks a tie. */
function newestFirst(ordered: NoteRow[]): NoteRow[] {
  return ordered.map((note, contentIndex) => ({ note, contentIndex }))
    .sort((a, b) => b.note.created_at.localeCompare(a.note.created_at) || a.contentIndex - b.contentIndex)
    .map(({ note }) => note);
}

/** Every note, by the chance it is rated helpful, best first. More votes break
 *  a tie, then content order. Unhelpful notes and notes whose source changed
 *  sort like any other note, so they have no band of their own. */
function mostHelpfulFirst(ordered: NoteRow[], rankTally: (note: NoteRow) => RankTally): NoteRow[] {
  return ordered.map((note, contentIndex) => {
    const ranked = { ...note, ...rankTally(note) };
    return { note, p: probabilityHelpful(noteTally(ranked)), votes: totalVotes(ranked), contentIndex };
  })
    .sort((a, b) => b.p - a.p || b.votes - a.votes || a.contentIndex - b.contentIndex)
    .map(({ note }) => note);
}

/** Arranges notes that are already in content order in the order the reader
 *  picked. Only the mixed order has the bands for unhelpful notes and notes
 *  whose source changed. The newest order has a band per span of time, which
 *  `now` places on the calendar. The most helpful order is one plain list. */
export function arrangeFeed(ordered: NoteRow[], order: FeedOrder, rankTally: (note: NoteRow) => RankTally, now: Date): FeedSection[] {
  if (order === "recent") return sectionsByAge(newestFirst(ordered), now);
  if (order === "helpful") return [{ label: null, notes: mostHelpfulFirst(ordered, rankTally) }];
  return rankFeed(ordered, rankTally);
}

/** The first `count` notes of the feed, taken from its bands in the order they
 *  render. A page that renders a long feed in steps shows this much of it. */
export function firstNotes(sections: FeedSection[], count: number): FeedSection[] {
  let left = count;
  return sections.map(({ label, notes }) => {
    const taken = notes.slice(0, left);
    left -= taken.length;
    return { label, notes: taken };
  });
}

/** How many notes the feed holds across its bands. */
export const feedLength = (sections: FeedSection[]) => sections.reduce((sum, { notes }) => sum + notes.length, 0);

/** The minimums a note must reach to stay in the All notes feed. `views`
 *  belongs to the note's post: it counts the devices outside our team on which
 *  the extension showed that post's notes. The three vote minimums count all
 *  votes, Helpful votes and Not helpful votes. */
export interface NoteFilters {
  views: number;
  votes: number;
  helpful: number;
  notHelpful: number;
}

/** Notes on posts that at least a few real readers saw come first by default,
 *  because a vote on those improves what people actually read. */
export const DEFAULT_NOTE_FILTERS: NoteFilters = { views: 5, votes: 0, helpful: 0, notHelpful: 0 };

/** Each filter's value for one note. */
export function filterValues(note: NoteRow, viewsOf: (note: NoteRow) => number, tally: RankTally): NoteFilters {
  return {
    views: viewsOf(note),
    votes: totalVotes(tally),
    helpful: tally.helpful_count,
    notHelpful: tally.not_helpful_count,
  };
}

/** The notes that reach every minimum, in the order given. Votes are read from
 *  `rankTally`, the counts a note had when it first appeared, so a card does
 *  not vanish under a reader who just took back a vote. */
export function filterNotes(notes: NoteRow[], filters: NoteFilters, viewsOf: (note: NoteRow) => number, rankTally: (note: NoteRow) => RankTally): NoteRow[] {
  const keys = Object.keys(filters) as (keyof NoteFilters)[];
  return notes.filter((note) => {
    const values = filterValues(note, viewsOf, rankTally(note));
    return keys.every((key) => values[key] >= filters[key]);
  });
}

/** Whose notes the All notes feed shows: everyone's, only the AI's, only
 *  people's, or the notes of one person, named by their author id. */
export type AuthorFilter = "anyone" | "ai" | "people" | `person:${string}`;

export const personFilter = (authorId: string): AuthorFilter => `person:${authorId}`;

export function matchesAuthor(note: NoteRow, filter: AuthorFilter): boolean {
  if (filter === "anyone") return true;
  if (filter === "ai") return note.author_id === null;
  if (filter === "people") return note.author_id !== null;
  return filter === personFilter(note.author_id ?? "");
}

export interface NoteAuthor {
  id: string;
  name: string;
  noteCount: number;
}

/** Every person who wrote one of the notes, with the name on their newest
 *  note, most notes first. A note posted without a name counts as anonymous. */
export function noteAuthors(notes: Iterable<NoteRow>): NoteAuthor[] {
  const byId = new Map<string, NoteAuthor & { newest: string }>();
  for (const note of notes) {
    if (!note.author_id) continue;
    const author = byId.get(note.author_id) ?? { id: note.author_id, name: "Anonymous", noteCount: 0, newest: "" };
    author.noteCount++;
    if (note.created_at > author.newest) {
      author.newest = note.created_at;
      author.name = note.author_name ?? "Anonymous";
    }
    byId.set(note.author_id, author);
  }
  return [...byId.values()]
    .sort((a, b) => b.noteCount - a.noteCount || a.name.localeCompare(b.name))
    .map(({ id, name, noteCount }) => ({ id, name, noteCount }));
}
