import type { AbComboCounts } from "./abStats";
import type { Database, Json } from "./database.types";
import type { QueryRequest } from "./fieldQuery";
import { supabase } from "./supabase";

/* What the X notewriter page and the admin dashboard's notes read: notes, the
 * pipeline runs behind them, and the A/B tests those runs drew. Every read is
 * one database function of migration 159 that returns only what one part of a
 * page shows. The source says whose notes: "x" is our notes on X and the X
 * bot's runs, "commonnotes" the notes on commonnotes.net and their claim
 * checks. */

export type NotewriterSource = "x" | "commonnotes";

export const X_NOTE_PAGE_SIZE = 10;

export type NoteRating = "helpful" | "not_helpful" | "needs_ratings";

/** A photo, video or gif of a post, as the X API sent it. */
export interface XMedia {
  type: string;
  url?: string;
  preview_image_url?: string;
  variants?: { url: string; bit_rate?: number; content_type: string }[];
}

/** One note with the post it is on. */
export interface XNote {
  noteId: string;
  noteText: string;
  status: NoteRating;
  written: string;
  views: number;
  /** The ratings in X's public data dump, which lags about 3 days. Null
   *  before the dump has the note. */
  ratings: {
    helpful: number;
    somewhatHelpful: number;
    notHelpful: number;
    helpfulReasons: Record<string, number>;
    notHelpfulReasons: Record<string, number>;
  } | null;
  /** Null when we never stored the post. */
  post: {
    id: string;
    text: string | null;
    handle: string | null;
    name: string | null;
    postedAt: string | null;
    media: XMedia[];
    /** The post this one quotes or replies to. */
    referenced: { kind: "quoted" | "replied_to" | "retweeted" | null; text: string | null; media: XMedia[] } | null;
  } | null;
  /** Every field of the note's field row, for the chips of a bucketed sort. */
  fields: Record<string, unknown>;
  sortKey: number[] | null;
}

export interface XNoteCursor {
  key: number[];
  id: string;
}

type CardRow = Database["public"]["CompositeTypes"]["x_note_card"];

function toXNote(row: CardRow): XNote {
  const fields = row.fields as Record<string, unknown>;
  const referenced = row.referenced_post as { text?: string; media?: XMedia[] } | null;
  return {
    noteId: row.note_id!,
    noteText: row.note_text ?? "",
    status: fields.status as NoteRating,
    written: fields.written as string,
    views: fields.views as number,
    ratings:
      row.helpful_ratings === null
        ? null
        : {
            helpful: row.helpful_ratings,
            somewhatHelpful: row.somewhat_helpful_ratings ?? 0,
            notHelpful: row.not_helpful_ratings ?? 0,
            helpfulReasons: (row.helpful_tags ?? {}) as Record<string, number>,
            notHelpfulReasons: (row.not_helpful_tags ?? {}) as Record<string, number>,
          },
    post:
      row.tweet_id === null || (row.post_text === null && row.author_handle === null)
        ? null
        : {
            id: row.tweet_id,
            text: row.post_text,
            handle: row.author_handle,
            name: row.author_name,
            postedAt: row.posted_at,
            media: (row.media ?? []) as unknown as XMedia[],
            referenced: referenced && {
              kind: row.referenced_kind as "quoted" | "replied_to" | "retweeted" | null,
              text: referenced.text ?? null,
              media: referenced.media ?? [],
            },
          },
    fields,
    sortKey: row.sort_key,
  };
}

/** The request as the database functions take it. */
const requestArg = (request: QueryRequest) => request as unknown as Json;

/** One page of our X notes that pass the request's filters, in its order,
 *  starting after `cursor`. Only the X page lists notes. */
export async function fetchXNotePage(request: QueryRequest, cursor: XNoteCursor | null): Promise<XNote[]> {
  const { data, error } = await supabase.rpc("x_notewriter_page", {
    p_request: requestArg(request),
    p_after_key: cursor?.key,
    p_after_id: cursor?.id,
    p_limit: X_NOTE_PAGE_SIZE,
  });
  if (error) throw error;
  return data.map(toXNote);
}

export interface NoteSummary {
  notes: number;
  helpful: number;
  views: number;
}

export async function fetchNoteSummary(source: NotewriterSource, request: QueryRequest): Promise<NoteSummary> {
  const { data, error } = await supabase.rpc("notewriter_summary", { p_source: source, p_request: requestArg(request) }).single();
  if (error) throw error;
  return data;
}

/** How many notes each value of these choice fields would show under the
 *  request's other filters, by field. */
export async function fetchNoteFacets(source: NotewriterSource, request: QueryRequest, columns: string[]): Promise<Record<string, { value: string; count: number }[]>> {
  const { data, error } = await supabase.rpc("notewriter_facets", { p_source: source, p_request: requestArg(request), p_facets: columns.map((column) => ({ column })) });
  if (error) throw error;
  const byField: Record<string, { value: string; count: number }[]> = {};
  for (const row of data) (byField[row.field] ??= []).push({ value: row.value, count: row.notes });
  return byField;
}

/** One UTC day of notes by status, and of pipeline runs when asked for. A
 *  Common Notes claim check counts as submitted when it wrote a note. */
export interface NoteDay {
  day: string;
  helpful: number;
  notHelpful: number;
  needsRatings: number;
  runs: number;
  submittedRuns: number;
}

/** The notes that pass the request's filters, per day. With `withRuns`, also
 *  every run of the day, under the request's A/B filters only. */
export async function fetchNoteDays(source: NotewriterSource, request: QueryRequest, withRuns: boolean): Promise<NoteDay[]> {
  const { data, error } = await supabase.rpc("notewriter_days", { p_source: source, p_request: requestArg(request), p_with_runs: withRuns });
  if (error) throw error;
  return data.map((d) => ({ day: d.day, helpful: d.helpful, notHelpful: d.not_helpful, needsRatings: d.needs_ratings, runs: d.runs, submittedRuns: d.submitted_runs }));
}

/** One UTC day of the notes rated helpful on X, by who wrote them. The human
 *  count is what is left after ours and the other AI note writers'. */
export interface OriginDay {
  day: string;
  total: number;
  ours: number;
  otherAi: number;
}

export async function fetchOriginDays(): Promise<OriginDay[]> {
  const { data, error } = await supabase.rpc("x_notewriter_origin_days");
  if (error) throw error;
  return data.map((d) => ({ day: d.day, total: d.helpful_total, ours: d.helpful_ours, otherAi: d.helpful_other_ai }));
}

/** An A/B test, live in the code or retired. `recentlyVaried` is true when a
 *  run of the last 3 days drew another arm than the control. Common Notes
 *  offers only the tests its own checks ever varied. */
export interface AbTest {
  name: string;
  live: boolean;
  control: string;
  variants: string[];
  recentlyVaried: boolean;
}

export async function fetchAbTests(source: NotewriterSource): Promise<AbTest[]> {
  const { data, error } = await supabase.rpc("notewriter_tests", { p_source: source });
  if (error) throw error;
  return data.map((t) => ({ name: t.test, live: t.live, control: t.control_variant, variants: t.variants, recentlyVaried: t.recently_varied }));
}

/** The failure modes reviewers tagged and the reasons raters gave, each with
 *  how often, most common first. */
export async function fetchAbReasons(source: NotewriterSource): Promise<{ kind: "failure_mode" | "rating_reason"; name: string; count: number }[]> {
  const { data, error } = await supabase.rpc("notewriter_reasons", { p_source: source });
  if (error) throw error;
  return data.map((r) => ({ kind: r.kind as "failure_mode" | "rating_reason", name: r.reason, count: r.uses }));
}

/** One combination of arms of the compared tests, with its counts. */
export interface AbCombo {
  picks: Record<string, string>;
  counts: AbComboCounts;
}

/** The notes and finished runs since `since` (a UTC day, or null for all
 *  time), grouped by the arms they drew on `tests`. */
export async function fetchAbCombos(source: NotewriterSource, tests: string[], since: string | null): Promise<AbCombo[]> {
  const { data, error } = await supabase.rpc("notewriter_ab_compare", { p_source: source, p_tests: tests, p_since: since ?? undefined });
  if (error) throw error;
  return data.map((row) => ({
    picks: row.picks as Record<string, string>,
    counts: {
      helpful: row.helpful,
      unhelpful: row.not_helpful,
      nmr: row.needs_ratings,
      candidate: row.candidate_runs,
      total: row.runs,
      cost: row.cost,
      helpfulRatings: row.helpful_ratings,
      somewhatHelpfulRatings: row.somewhat_helpful_ratings,
      notHelpfulRatings: row.not_helpful_ratings,
      ratingReasonCounts: row.rating_reasons as Record<string, number>,
      reviewedNotes: row.reviewed,
      failureModeCounts: row.failure_modes as Record<string, number>,
    },
  }));
}
