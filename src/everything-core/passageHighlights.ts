import type { Tables } from "./database.types";

export type PassageHighlight = Tables<"everything_passage_highlights">;
export type PassageQuestion = Tables<"everything_passage_questions">;
export type HighlightDraft = { kind: "forecast"; probability: number; statement: string } | { kind: "key_point"; statement: string };
/** A note Opus drafted for the reader to edit and post as their own. */
export type NoteDraft = { kind: "note"; text: string };
/** Anything Ask Opus can draft. */
export type OpusDraft = HighlightDraft | NoteDraft;

/** What the reader did with the draft Opus wrote for a question: posted it as
 *  the note or highlight `postedId`, or discarded it. Null while it waits. */
export type DraftOutcome = { kind: "posted"; postedId: string } | { kind: "discarded" };

export function draftOutcome(question: Pick<PassageQuestion, "draft_outcome" | "draft_posted_id">): DraftOutcome | null {
  if (question.draft_outcome === "posted" && question.draft_posted_id) return { kind: "posted", postedId: question.draft_posted_id };
  return question.draft_outcome === "discarded" ? { kind: "discarded" } : null;
}

/** The error the intake service stores on a question once the day's budget
 *  for reader requests is spent. */
export const QUESTION_BUDGET_ERROR = "Daily budget reached";

/** Whether Opus has yet to answer the question. */
export const isWaiting = (question: Pick<PassageQuestion, "status">) => question.status === "pending" || question.status === "answering";

/** The database refuses a reader's note longer than this (migration 114). */
export const MAX_READER_NOTE_LENGTH = 2000;

export function validHighlight(kind: string, probability: number | null, statement: string): boolean {
  return !!statement.trim() && statement.length <= 2000 && (kind === "forecast"
    ? probability !== null && Number.isInteger(probability) && probability >= 0 && probability <= 100
    : kind === "key_point" && probability === null);
}

export function highlightSentence(highlight: { kind: string; probability?: number | null; statement: string }): string {
  return highlight.kind === "forecast"
    ? `This is a forecast of a ${highlight.probability}% chance of “${highlight.statement}”`
    : `A key point in this article is “${highlight.statement}”`;
}

export function parseHighlightDraft(value: unknown): HighlightDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Record<string, unknown>;
  if (typeof draft.statement !== "string") return null;
  if (draft.kind === "forecast" && typeof draft.probability === "number" && validHighlight(draft.kind, draft.probability, draft.statement)) {
    return { kind: draft.kind, probability: draft.probability, statement: draft.statement };
  }
  return draft.kind === "key_point" && validHighlight(draft.kind, null, draft.statement)
    ? { kind: draft.kind, statement: draft.statement } : null;
}

export function parseOpusDraft(value: unknown): OpusDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Record<string, unknown>;
  if (draft.kind !== "note") return parseHighlightDraft(value);
  return typeof draft.text === "string" && draft.text.trim() && draft.text.length <= MAX_READER_NOTE_LENGTH ? { kind: "note", text: draft.text } : null;
}
