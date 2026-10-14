import { noteTally, probabilityHelpful } from "@cn/core/noteBelief";
import { noteStatus } from "@cn/core/noteScore";
import type { Note, ScoredNote } from "./types";

export function rankNotes(rows: Note[]): ScoredNote[] {
  return rows.map(n => ({
    ...n,
    votes: n.helpful_count + n.somewhat_helpful_count + n.not_helpful_count,
    p: probabilityHelpful(noteTally(n)),
    status: noteStatus(n),
  })).sort((a, b) => b.p - a.p || b.votes - a.votes);
}
