/**
 * Decides what the Slack channels should hear about, from the notes and votes
 * of a recent time window, and remembers what was already posted.
 *
 * There are four channels:
 * - on_important_creator: new notes on a few handpicked creators. Our AI's notes
 *   on one post are announced together once the post is finished. A note a
 *   person wrote gets its own message.
 * - written_by_human: every note a person wrote, on any creator.
 * - first_helpful_vote: a note got its first Helpful vote from someone other
 *   than its author. Somewhat helpful does not count. The author's own vote,
 *   which a database trigger casts automatically, never counts.
 * - helpful: a note became rated helpful, by the same rule the website uses.
 */

import { getSupabaseClient } from "../../api/supabaseClient";
import { noteStatus } from "../../everything-core/noteScore";
import { fetchAllRows, fetchInBatches } from "../../everything-core/paging";
import type { Vote } from "../../everything-core/votes";
import {
  firstHelpfulVoteMessage,
  humanNoteMessage,
  importantCreatorPostMessages,
  ratedHelpfulMessage,
  type NoteWithContext,
} from "./messages";

export type SlackChannel = "on_important_creator" | "written_by_human" | "first_helpful_vote" | "helpful";

/** One event to post. `subjectId` is what the event is about: a note, or for a
 *  finished post on an important creator, the post's item. Most events are one
 *  message. A post with many notes can need several. */
export type Announcement = { channel: SlackChannel; subjectId: string; messages: string[] };

/** The creators Jim picked on 2026-09-24 (GOO-228): Astral Codex Ten, Andy
 *  Masley, Bentham's Bulldog, Predictive Text and Don't Worry About the Vase.
 *  They are matched by feed URL, because a project's slug is only a name. */
const IMPORTANT_CREATOR_FEED_URLS = new Set([
  "https://astralcodexten.substack.com",
  "https://andymasley.substack.com",
  "https://benthams.substack.com",
  "https://nathanpmyoung.substack.com",
  "https://thezvi.substack.com",
]);

const HELPFUL_VOTE: Vote = 1;

const NOTE_WITH_CONTEXT_COLUMNS =
  "id, note, created_at, author_id, author_name, improved_from_note_id, helpful_count, somewhat_helpful_count, not_helpful_count, " +
  "claim:everything_claims!inner(claim, context_quote, item:everything_items!inner(id, title, url, status, project:everything_projects(slug, name, feed_url)))";

type HelpfulVote = { id: string; note_id: string; voter_id: string; updated_at: string };

const isOnImportantCreator = (note: NoteWithContext) =>
  IMPORTANT_CREATOR_FEED_URLS.has(note.claim.item.project?.feed_url ?? "");

export async function findAnnouncements(since: string): Promise<Announcement[]> {
  const [recentNotes, voteAnnouncements] = await Promise.all([fetchNotesCreatedSince(since), findVoteAnnouncements(since)]);
  return [...noteAnnouncements(recentNotes), ...voteAnnouncements];
}

async function fetchNotesCreatedSince(since: string): Promise<NoteWithContext[]> {
  return fetchAllRows<NoteWithContext>(
    () => getSupabaseClient().from("everything_notes").select(NOTE_WITH_CONTEXT_COLUMNS).neq("status", "hidden").gte("created_at", since),
    "id",
    { label: "notifyRecentNotes" },
  );
}

/** The announcements for newly written notes. Our AI's notes on an important
 *  creator wait until their post is finished, so the whole post goes out as
 *  one announcement. */
export function noteAnnouncements(notes: NoteWithContext[]): Announcement[] {
  const announcements: Announcement[] = [];
  const aiNotesByFinishedPost = new Map<string, NoteWithContext[]>();
  for (const note of [...notes].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (note.author_id) {
      const messages = [humanNoteMessage(note)];
      announcements.push({ channel: "written_by_human", subjectId: note.id, messages });
      if (isOnImportantCreator(note)) announcements.push({ channel: "on_important_creator", subjectId: note.id, messages });
    } else if (isOnImportantCreator(note) && note.claim.item.status === "done") {
      const itemId = note.claim.item.id;
      aiNotesByFinishedPost.set(itemId, [...(aiNotesByFinishedPost.get(itemId) ?? []), note]);
    }
  }
  for (const [itemId, postNotes] of aiNotesByFinishedPost) {
    announcements.push({ channel: "on_important_creator", subjectId: itemId, messages: importantCreatorPostMessages(postNotes) });
  }
  return announcements;
}

/** Every note with a vote cast or changed in the window is a candidate for the
 *  two vote channels. */
async function findVoteAnnouncements(since: string): Promise<Announcement[]> {
  const db = getSupabaseClient();
  const recentVotes = await fetchAllRows<{ id: string; note_id: string }>(
    () => db.from("everything_votes").select("id, note_id").gte("updated_at", since),
    "id",
    { label: "notifyRecentVotes" },
  );
  const noteIds = [...new Set(recentVotes.map((vote) => vote.note_id))];
  if (noteIds.length === 0) return [];
  const [notes, helpfulVotes] = await Promise.all([
    fetchInBatches<NoteWithContext>(
      (chunk) => db.from("everything_notes").select(NOTE_WITH_CONTEXT_COLUMNS).neq("status", "hidden").in("id", chunk),
      noteIds,
      "id",
      { label: "notifyVotedNotes" },
    ),
    fetchInBatches<HelpfulVote>(
      (chunk) => db.from("everything_votes").select("id, note_id, voter_id, updated_at").eq("vote", HELPFUL_VOTE).in("note_id", chunk),
      noteIds,
      "id",
      { label: "notifyHelpfulVotes" },
    ),
  ]);
  return [
    ...notes
      .filter((note) => firstHelpfulVoteIsSince(note, helpfulVotes, since))
      .map((note): Announcement => ({ channel: "first_helpful_vote", subjectId: note.id, messages: [firstHelpfulVoteMessage(note)] })),
    ...notes
      .filter((note) => noteStatus(note) === "helpful")
      .map((note): Announcement => ({ channel: "helpful", subjectId: note.id, messages: [ratedHelpfulMessage(note)] })),
  ];
}

/** True when the note's earliest Helpful vote from someone other than its
 *  author falls inside the window. A note whose first such vote is older was
 *  already announced, or it got that vote before this service existed. */
export function firstHelpfulVoteIsSince(note: NoteWithContext, helpfulVotes: HelpfulVote[], since: string): boolean {
  const times = helpfulVotes
    .filter((vote) => vote.note_id === note.id && vote.voter_id !== note.author_id)
    .map((vote) => vote.updated_at);
  return times.length > 0 && times.reduce((a, b) => (a < b ? a : b)) >= since;
}

export async function dropAnnounced(announcements: Announcement[]): Promise<Announcement[]> {
  if (announcements.length === 0) return [];
  // The paging helper wants a unique key, and subject_id repeats once per
  // channel. That is safe here: a batch holds at most 200 subjects, so at most
  // 800 rows, and that always fits in one page.
  const posted = await fetchInBatches<{ channel: SlackChannel; subject_id: string }>(
    (chunk) => getSupabaseClient().from("everything_slack_announcements").select("channel, subject_id").in("subject_id", chunk),
    [...new Set(announcements.map((a) => a.subjectId))],
    "subject_id",
    { label: "notifyPosted" },
  );
  const postedKeys = new Set(posted.map((row) => `${row.channel}:${row.subject_id}`));
  return announcements.filter((a) => !postedKeys.has(`${a.channel}:${a.subjectId}`));
}

export async function recordAnnouncement(announcement: Announcement): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("everything_slack_announcements")
    .insert({ channel: announcement.channel, subject_id: announcement.subjectId });
  if (error) throw new Error(`Recording the ${announcement.channel} announcement of ${announcement.subjectId} failed: ${error.message}`);
}
