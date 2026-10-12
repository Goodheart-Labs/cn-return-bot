/**
 * The text of every Slack message the cn-notify service posts. Pure functions,
 * so the wording can be tested without Slack or the database.
 */

import { noteShareUrl } from "../../everything-core/pageUrls";

/** A note with the claim, post and creator it belongs to, as one nested row. */
export type NoteWithContext = {
  id: string;
  note: string;
  created_at: string;
  author_id: string | null;
  author_name: string | null;
  improved_from_note_id: string | null;
  helpful_count: number;
  somewhat_helpful_count: number;
  not_helpful_count: number;
  claim: {
    claim: string;
    context_quote: string | null;
    item: {
      id: string;
      title: string | null;
      url: string;
      status: string;
      project: { slug: string; name: string; feed_url: string | null } | null;
    };
  };
};

/** Slack refuses a message whose Markdown is longer than this. */
const SLACK_MARKDOWN_LIMIT = 12_000;

const quoteLines = (text: string) => text.split("\n").map((line) => `> ${line}`).join("\n");

function postLink(note: NoteWithContext): string {
  const { item } = note.claim;
  const creator = item.project ? ` by ${item.project.name}` : "";
  return `[${item.title?.trim() || item.url}](${item.url})${creator}`;
}

const writtenBy = (note: NoteWithContext) =>
  note.author_id ? `Written by ${note.author_name ?? "a reader"}.` : "Written by our AI.";

/** The passage the note is about, the note itself, and a link to it on the site. */
function noteBlock(note: NoteWithContext): string {
  const passage = note.claim.context_quote ?? note.claim.claim;
  const link = noteShareUrl(note.claim.item.project?.slug ?? null, note.id);
  return `${quoteLines(passage)}\n\n${note.note}\n\n[Open on Common Notes](${link})`;
}

/** Packs the blocks into as few messages as Slack accepts. The header opens
 *  the first message. */
export function packIntoMessages(header: string, blocks: string[]): string[] {
  const messages = [header];
  for (const block of blocks) {
    const last = messages.length - 1;
    const extended = `${messages[last]}\n\n${block}`;
    if (extended.length <= SLACK_MARKDOWN_LIMIT) messages[last] = extended;
    else messages.push(block);
  }
  return messages;
}

/** All AI notes of one finished post, which must all belong to the same post. */
export function importantCreatorPostMessages(notes: NoteWithContext[]): string[] {
  const count = notes.length === 1 ? "1 new note" : `${notes.length} new notes`;
  return packIntoMessages(`**${count}** on ${postLink(notes[0]!)}`, notes.map(noteBlock));
}

export function humanNoteMessage(note: NoteWithContext): string {
  const action = note.improved_from_note_id ? "improved a note" : "wrote a note";
  return `**${note.author_name ?? "A reader"}** ${action} on ${postLink(note)}\n\n${noteBlock(note)}`;
}

export function firstHelpfulVoteMessage(note: NoteWithContext): string {
  return `**First Helpful vote** on a note on ${postLink(note)}. ${writtenBy(note)}\n\n${noteBlock(note)}`;
}

export function ratedHelpfulMessage(note: NoteWithContext): string {
  const tally = `${note.helpful_count} Helpful, ${note.somewhat_helpful_count} Somewhat helpful, ${note.not_helpful_count} Not helpful`;
  return `**Rated helpful** (${tally}): a note on ${postLink(note)}. ${writtenBy(note)}\n\n${noteBlock(note)}`;
}
