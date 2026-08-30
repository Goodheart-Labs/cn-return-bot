import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows as fetchAllRowsShared } from "./paging";
import type { Post } from "./fetchEligiblePosts";
import type { FeedSize } from "../pipeline/orchestration/utils/feedSizeStrategy";
import { stripNullChars } from "../utils/stripNullChars";

// How often an --incremental scrape may scroll past a note without capturing it
// before we give up on that note. A note we have given up on no longer anchors
// the scrape window, so a permanently deleted note cannot pin the daily scrape
// to its date. The staged updates in markIncrementalMisses only work for the
// value 2.
const MISS_LIMIT = 2;

// Database types
export interface Notewriter {
  id: string;
  handle: string;
  display_name?: string;
  credentials_ref?: string;
  is_active: boolean;
  created_at: string;
}

// Migration 034 merged the old tables into `notes`, so one row is now the
// master record for one note. The submission metadata notewriter_id and
// submitted_at are null on rows that predate submission tracking. The rating
// and status fields are filled in from X's public data. Run, bot and score data
// live elsewhere. Join notes.note_id to pipeline_runs.note_id to reach it.
export interface Note {
  id: string;
  note_id: string;
  tweet_id: string;
  note_text?: string;
  source_url?: string;
  notewriter_id?: string;
  submitted_at?: string;
  cn_status?: string;
  view_count?: number;
  rating_count: number;
  helpful_count: number;
  somewhat_helpful_count: number;
  not_helpful_count: number;
  data_tier?: "platinum" | "gold" | "silver" | "junk" | "impossible";
  last_reconciled_at?: string;
  first_seen_at: string;
}

export interface PublicDataSnapshot {
  id?: string;
  note_id: string;
  tweet_id: string;
  current_status?: string;
  is_ours: boolean;
  snapshot_date: string;
  created_at_millis?: number;
  note_text?: string;
  created_at?: string;
  core_note_intercept?: number;
  core_note_factor1?: number;
}

// The insert payload for logNoteSubmission. It carries only the columns the
// submission pipeline knows at submit time. The status, the rating counts and
// the view count are filled in later by the updateNoteFeedback cron job and by
// the scraper.
export type NoteInsert = {
  note_id: string;
  tweet_id: string;
  note_text?: string;
  source_url?: string;
  notewriter_id?: string;
  submitted_at?: string;
};

let supabaseInstance: SupabaseClient | null = null;

type CountError = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

type ExactCountResponse = {
  count: number | null;
  error: CountError | null;
  status: number;
};

// Builds the count query. Passing head:true sends the normal request, which
// comes back without a body. Passing head:false sends a GET instead, which is
// the diagnostic fallback, because only a GET carries the error body. A builder
// should end with .limit(1). That does nothing on a HEAD request and keeps the
// GET fallback down to a single row.
type ExactCountQuery = (head: boolean) => PromiseLike<ExactCountResponse>;

const COUNT_RETRY_DELAYS_MS = [250, 1000] as const;
// Status 0 means the request failed at the network level. supabase-js resolves
// with no HTTP status in that case.
const RETRYABLE_COUNT_STATUSES = new Set([0, 408, 425, 429]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns the singleton supabase-js client.
 *
 * Heads-up for callers writing new queries. PostgREST silently caps the
 * response of a single `.select()` at 1000 rows. You get no error when your
 * result is larger. It is simply truncated. To fetch everything that matches a
 * query, use `fetchAllRows` from ./paging. That helper walks the result with a
 * keyset, so it handles any size. A bounded query with `.limit(N)` or
 * `.single()` is fine to call directly on this client.
 */
export function getSupabaseClient(): SupabaseClient {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY"
    );
  }

  supabaseInstance = createClient(supabaseUrl, supabaseKey);
  return supabaseInstance;
}

// Rows that carry a raw_tweet blob are large. Keep write batches small enough
// that a single PostgREST request stays well under the body size limit and the
// time limit.
const FEED_TWEETS_WRITE_CHUNK = 500;
// An existence check sends only ids, and they travel in the URL as
// `tweet_id=in.(...)`. So this chunk size is bounded by the length of the URL
// rather than by the size of a payload.
const FEED_TWEETS_ID_CHUNK = 200;

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Maps a Post from the eligibility endpoint onto the columns that the `tweets`
 * and `feed_tweets` tables have in common. It derives has_video, has_photo,
 * media_count and video_duration_ms from post.media. It stores the complete raw
 * X API object in raw_tweet. Each caller adds the timestamps that only its own
 * table has.
 */
function postToTweetRow(post: Post) {
  const videoMedia = post.media?.find((m) => m.type === "video");
  return {
    tweet_id: post.id,
    author_id: post.author_id,
    author_name: post.author_name,
    author_description: post.author_description,
    author_followers: post.author_followers,
    author_tweet_count: post.author_tweet_count,
    text: post.text,
    posted_at: post.created_at,
    impressions: post.public_metrics?.impression_count,
    likes: post.public_metrics?.like_count,
    retweets: post.public_metrics?.retweet_count,
    replies: post.public_metrics?.reply_count,
    quotes: post.public_metrics?.quote_count,
    bookmarks: post.public_metrics?.bookmark_count,
    media: post.media ?? null,
    referenced_tweets: post.referenced_tweets ?? null,
    referenced_tweet_data: post.referenced_tweet_data ?? null,
    raw_tweet: post.raw ?? null,
    has_video: !!videoMedia,
    has_photo: post.media?.some((m) => m.type === "photo") ?? false,
    media_count: post.media?.length ?? 0,
    video_duration_ms: videoMedia?.duration_ms,
  };
}

export class SupabaseLogger {
  private client: SupabaseClient;

  constructor() {
    this.client = getSupabaseClient();
  }

  /**
   * Fetches every row that matches `buildQuery()`. The paging itself is done by
   * the shared keyset paginator in src/api/paging.ts. The caller must supply a
   * `keyCol` that is unique and indexed. That is usually the table's primary
   * key.
   */
  async fetchAllRows<T extends Record<string, any>>(
    buildQuery: (from: SupabaseClient) => any,
    keyCol: string,
    label?: string,
  ): Promise<T[]> {
    return fetchAllRowsShared<T>(() => buildQuery(this.client), keyCol, { label });
  }

  /**
   * Writes the notes row after a successful submission. This is an upsert
   * rather than an insert because the scraper may have created the row already,
   * with a cn_status and a view_count, before our API response landed. In that
   * case we want to add the submission metadata to the existing row instead of
   * failing on the unique constraint.
   */
  async logNoteSubmission(note: NoteInsert): Promise<Note | null> {
    const { data, error } = await this.client
      .from("notes")
      .upsert(note, { onConflict: "note_id" })
      .select()
      .single();

    if (error) {
      console.error("[SupabaseLogger] Error logging note:", error);
      throw error;
    }

    console.log(`[SupabaseLogger] Successfully logged note: ${note.note_id}`);
    return data;
  }

  async getOrCreateNotewriter(handle: string, displayName?: string): Promise<Notewriter> {
    const { data: existing } = await this.client
      .from("notewriters")
      .select()
      .eq("handle", handle)
      .single();

    if (existing) {
      return existing;
    }

    const { data, error } = await this.client
      .from("notewriters")
      .insert({ handle, display_name: displayName })
      .select()
      .single();

    if (error) {
      console.error("[SupabaseLogger] Error creating notewriter:", error);
      throw error;
    }

    return data;
  }

  // ============================================
  // Scraped Notewriter Data Methods
  // ============================================

  async upsertScrapedNotewriterNote(data: {
    note_id: string;
    tweet_id: string;
    note_text?: string;
    source_url?: string;
  }): Promise<void> {
    const { error } = await this.client
      .from("notes")
      .upsert(
        {
          note_id: data.note_id,
          tweet_id: data.tweet_id,
          note_text: data.note_text,
          source_url: data.source_url,
        },
        {
          onConflict: "note_id",
          ignoreDuplicates: true,
        }
      );

    if (error) {
      console.error("[SupabaseLogger] Error upserting scraped notewriter note:", error);
      throw error;
    }
  }

  async insertScrapedNotewriterSnapshot(data: {
    note_id: string;
    tweet_id?: string;
    note_text?: string;
    cn_status?: string;
    view_count?: number;
    shown_on_x?: boolean | null;
    rater_tags?: string[];
    tweet_handle?: string;
    tweet_text?: string;
    tweet_time?: string;
  }): Promise<void> {
    const { error } = await this.client
      .from("scraped_notewriter_snapshots")
      .insert({
        note_id: data.note_id,
        tweet_id: data.tweet_id,
        note_text: data.note_text,
        cn_status: data.cn_status,
        view_count: data.view_count,
        shown_on_x: data.shown_on_x,
        rater_tags: data.rater_tags,
        tweet_handle: data.tweet_handle,
        tweet_text: data.tweet_text,
        tweet_time: data.tweet_time,
      });

    if (error) {
      console.error("[SupabaseLogger] Error inserting scraped notewriter snapshot:", error);
      throw error;
    }
  }

  async scrapedNotewriterNoteExists(noteId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("notes")
      .select("note_id")
      .eq("note_id", noteId)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("[SupabaseLogger] Error checking scraped notewriter note:", error);
      throw error;
    }

    return !!data;
  }

  async findScrapedNoteByTweetId(tweetId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("notes")
      .select("note_id")
      .eq("tweet_id", tweetId)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("[SupabaseLogger] Error finding scraped note by tweet_id:", error);
      throw error;
    }

    return data?.note_id || null;
  }

  /**
   * Changes a scraped note's note_id. The scraper stores a placeholder id of
   * the form tweet_XXXX until it can read the real id out of the note's modal.
   */
  async updateScrapedNoteId(oldNoteId: string, newNoteId: string): Promise<void> {
    // This is a single update on notes. The foreign key on
    // scraped_notewriter_snapshots.note_id is ON UPDATE CASCADE since migration
    // 036, so the snapshot rows that point at the old id are renamed in the
    // same transaction.
    const { error } = await this.client
      .from("notes")
      .update({ note_id: newNoteId })
      .eq("note_id", oldNoteId);

    if (error) {
      console.error("[SupabaseLogger] Error updating note_id:", error);
      throw error;
    }
  }

  /**
   * Returns the ids of the scraped notes that fall in the given id range.
   * Placeholder ids are left out. The scraper uses this to check its coverage.
   */
  async getScrapedNoteIdsInRange(minId: string, maxId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from("notes")
      .select("note_id")
      .gte("note_id", minId)
      .lte("note_id", maxId)
      .not("note_id", "like", "tweet_%");

    if (error) {
      console.error("[SupabaseLogger] Error fetching note IDs in range:", error);
      return [];
    }

    return (data || []).map((n: { note_id: string }) => n.note_id);
  }

  /**
   * Reads in one query whether a note row exists and whether it already has a
   * first snapshot. The scraper needs both facts to decide whether to create the
   * row and whether to stamp `first_snapshot_at`, and this saves it a second
   * round trip.
   */
  async getNoteSnapshotState(noteId: string): Promise<{ exists: boolean; hasFirstSnapshot: boolean }> {
    const { data, error } = await this.client
      .from("notes")
      .select("note_id, first_snapshot_at")
      .eq("note_id", noteId)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("[SupabaseLogger] Error reading note snapshot state:", error);
      throw error;
    }

    return { exists: !!data, hasFirstSnapshot: !!data?.first_snapshot_at };
  }

  /**
   * Records when a note first received a scraper snapshot. The update only
   * touches rows where the value is still null, so calling it again changes
   * nothing. This column is what makes getOldestUnscrapedNoteId a cheap indexed
   * lookup instead of a scan over the whole snapshots time series.
   */
  async markFirstSnapshot(noteId: string): Promise<void> {
    const { error } = await this.client
      .from("notes")
      .update({ first_snapshot_at: new Date().toISOString() })
      .eq("note_id", noteId)
      .is("first_snapshot_at", null);

    if (error) {
      console.error("[SupabaseLogger] Error stamping first_snapshot_at:", error);
      throw error;
    }
  }

  /**
   * Returns the oldest note that may still anchor an --incremental scrape. A
   * note qualifies when it has no snapshot yet, so `first_snapshot_at` is null,
   * and when it has not been given up after repeated misses, so `scrape_misses`
   * is still below MISS_LIMIT. markFirstSnapshot stamps `first_snapshot_at` on a
   * note's first snapshot, see migration 048. The partial index
   * `idx_notes_incremental_anchor` covers exactly this predicate, so the read is
   * cheap and never scans the snapshots time series. Returns null when every
   * known note either has a snapshot or has been given up.
   */
  async getOldestUnscrapedNoteId(): Promise<string | null> {
    // note_id is a text column, so .order() sorts it as text. We take a small
    // window of the smallest ids in that order and then pick the true minimum by
    // comparing them as BigInts. That guards against ids of different lengths.
    const TOP_CANDIDATES = 50;
    const { data, error } = await this.client
      .from("notes")
      .select("note_id")
      .is("first_snapshot_at", null)
      .lt("scrape_misses", MISS_LIMIT)
      .not("note_id", "like", "tweet_%")
      .not("note_id", "like", "unavailable_%")
      .order("note_id", { ascending: true })
      .limit(TOP_CANDIDATES);

    if (error) {
      console.error("[SupabaseLogger] Error fetching oldest unscraped note id:", error);
      throw error;
    }

    const numericIds = (data || [])
      .map((n: { note_id: string }) => n.note_id)
      .filter((id: string) => /^\d+$/.test(id));
    if (numericIds.length === 0) return null;

    return numericIds.reduce((min, id) => (BigInt(id) < BigInt(min) ? id : min));
  }

  /**
   * Accounts for the notes an --incremental run scrolled past but failed to
   * capture. Those are the notes that still have no snapshot and whose note_id
   * is at or above the lowest id the run did capture. A note is given up once it
   * has been missed MISS_LIMIT times.
   *
   * The counting uses two updates that each write a literal value. That way it
   * needs no arithmetic on a column and therefore no RPC. The first update
   * promotes the already-missed notes to MISS_LIMIT, which gives up on them. The
   * second records a first miss for the rest. The order matters. It stops a note
   * from being given up in the same run in which it was first missed.
   *
   * A captured note gets first_snapshot_at set and therefore leaves this set, so
   * the misses it counts are effectively consecutive. Returns both counts for
   * logging.
   */
  async markIncrementalMisses(minCoveredNoteId: string): Promise<{ givenUp: number; firstMisses: number }> {
    const coveredUnscraped = (q: any) =>
      q.is("first_snapshot_at", null)
        .gte("note_id", minCoveredNoteId)
        .not("note_id", "like", "tweet_%")
        .not("note_id", "like", "unavailable_%");

    // Step 1. A note that was missed before and is missed again is given up.
    const { data: givenUp, error: giveUpErr } = await coveredUnscraped(
      this.client.from("notes").update({ scrape_misses: MISS_LIMIT }),
    )
      .eq("scrape_misses", MISS_LIMIT - 1)
      .select("note_id");
    if (giveUpErr) {
      console.error("[SupabaseLogger] Error giving up on unscrapable notes:", giveUpErr);
      throw giveUpErr;
    }

    // Step 2. Record a first miss for the notes that were never missed before.
    const { data: firstMissed, error: firstMissErr } = await coveredUnscraped(
      this.client.from("notes").update({ scrape_misses: 1 }),
    )
      .eq("scrape_misses", 0)
      .select("note_id");
    if (firstMissErr) {
      console.error("[SupabaseLogger] Error recording first scrape misses:", firstMissErr);
      throw firstMissErr;
    }

    return { givenUp: (givenUp || []).length, firstMisses: (firstMissed || []).length };
  }

  // ============================================
  // Tweets
  // ============================================

  /**
   * Inserts the tweets we fetched from the eligibility endpoint. It only ever
   * inserts. A row whose tweet_id already exists is skipped, so its engagement
   * metrics stay frozen at the values we saw the first time.
   */
  async bulkInsertNewTweets(posts: Post[]): Promise<void> {
    if (!posts.length) return;
    const now = new Date().toISOString();
    const rows = posts.map((post) => ({ ...postToTweetRow(post), last_updated_at: now }));
    const { error } = await this.client.from("tweets").upsert(rows, { onConflict: "tweet_id", ignoreDuplicates: true });
    if (error) {
      console.error(`[SupabaseLogger] Error bulk-inserting ${rows.length} tweets:`, error);
      throw error;
    }
  }

  /**
   * Inserts a feed_tweets row for every post we are seeing for the first time.
   * Such a row freezes first_seen_impressions and first_seen_feed_size. Floor
   * analyses need both values to reconstruct how fast a post was growing when
   * the feed first surfaced it. The plain `impressions` column cannot serve that
   * purpose, because it is refreshed every time we see the post again.
   *
   * Tweet ids we already know are filtered out with cheap id-only reads before
   * anything is sent. The feed ladder re-surfaces the same below-floor posts on
   * every 15-minute run. Re-sending their raw_tweet blobs only for the server to
   * skip them would dwarf the payload of the genuinely new posts.
   *
   * Returns the ids that were actually inserted.
   */
  async insertNewFeedTweets(sightings: { post: Post; feedSize: FeedSize }[]): Promise<Set<string>> {
    if (!sightings.length) return new Set();

    const known = new Set<string>();
    for (const chunk of chunked(sightings.map((s) => s.post.id), FEED_TWEETS_ID_CHUNK)) {
      const { data, error } = await this.client.from("feed_tweets").select("tweet_id").in("tweet_id", chunk);
      if (error) {
        console.error(`[SupabaseLogger] Error checking ${chunk.length} feed tweet ids:`, error);
        throw error;
      }
      for (const row of data ?? []) known.add(row.tweet_id);
    }

    const now = new Date().toISOString();
    const fullRows = sightings
      .filter((s) => !known.has(s.post.id))
      .map(({ post, feedSize }) => ({
        ...postToTweetRow(post),
        first_seen_at: now,
        last_seen_at: now,
        first_seen_impressions: post.public_metrics?.impression_count,
        first_seen_feed_size: feedSize,
      }));

    // Do nothing on conflict, because a concurrent writer may have won the race.
    // The .select() then returns only the rows this call actually inserted.
    const insertedIds = new Set<string>();
    for (const chunk of chunked(fullRows, FEED_TWEETS_WRITE_CHUNK)) {
      const { data, error } = await this.client
        .from("feed_tweets")
        .upsert(chunk, { onConflict: "tweet_id", ignoreDuplicates: true })
        .select("tweet_id");
      if (error) {
        console.error(`[SupabaseLogger] Error inserting ${chunk.length} feed tweets:`, error);
        throw error;
      }
      for (const row of data ?? []) insertedIds.add(row.tweet_id);
    }
    return insertedIds;
  }

  /**
   * Saves every post from a full pull of the eligible feed into feed_tweets. A
   * tweet we see for the first time gets a full row through insertNewFeedTweets,
   * including the large raw_tweet blob. For a tweet we already know we refresh
   * only its engagement metrics, its author counts and last_seen_at. The large
   * JSONB and text columns are never rewritten. Returns how many rows were
   * inserted and how many were updated, for the run log.
   */
  async bulkSaveFeedTweets(posts: Post[], feedSize: FeedSize): Promise<{ inserted: number; updated: number }> {
    if (!posts.length) return { inserted: 0, updated: 0 };
    const now = new Date().toISOString();

    const insertedIds = await this.insertNewFeedTweets(posts.map((post) => ({ post, feedSize })));

    // Second pass. For the tweets we already knew, refresh only the columns
    // whose values change over time.
    const metricRows = posts
      .filter((post) => !insertedIds.has(post.id))
      .map((post) => ({
        tweet_id: post.id,
        author_followers: post.author_followers,
        author_tweet_count: post.author_tweet_count,
        impressions: post.public_metrics?.impression_count,
        likes: post.public_metrics?.like_count,
        retweets: post.public_metrics?.retweet_count,
        replies: post.public_metrics?.reply_count,
        quotes: post.public_metrics?.quote_count,
        bookmarks: post.public_metrics?.bookmark_count,
        last_seen_at: now,
      }));
    for (const chunk of chunked(metricRows, FEED_TWEETS_WRITE_CHUNK)) {
      const { error } = await this.client.from("feed_tweets").upsert(chunk, { onConflict: "tweet_id" });
      if (error) {
        console.error(`[SupabaseLogger] Error refreshing ${chunk.length} feed tweet metrics:`, error);
        throw error;
      }
    }

    return { inserted: insertedIds.size, updated: metricRows.length };
  }

  // ============================================
  // Pipeline Tracking
  // ============================================

  /**
   * Creates the pipeline run row for a tweet that is starting to process.
   * Returns the run id, which the caller uses later to attach scores to the run.
   */
  async createPipelineRun(data: {
    tweet_id: string;
    bot_name?: string;
    ab_test_picks?: Record<string, string>;
    bot_config?: Record<string, unknown>;
    commit_sha?: string;
  }): Promise<string> {
    const { data: result, error } = await this.client
      .from("pipeline_runs")
      .insert({
        tweet_id: data.tweet_id,
        bot_name: data.bot_name,
        ab_test_picks: data.ab_test_picks,
        bot_config: data.bot_config,
        commit_sha: data.commit_sha,
        outcome: "in_progress", // The pipeline overwrites this when it finishes.
        final_stage: "started",
      })
      .select("id")
      .single();

    if (error) {
      console.error("[SupabaseLogger] Error creating pipeline run:", error);
      throw error;
    }

    return result.id;
  }

  async completePipelineRun(
    runId: string,
    data: {
      outcome: "submitted" | "filtered" | "failed" | "rejected" | "candidate";
      outcome_reason?: string;
      error_message?: string;
      warnings?: string[];
      final_stage: string;
      note_id?: string;
      bot_name?: string;
      ab_test_picks?: Record<string, string>;
      bot_config?: Record<string, unknown>;
      note_text?: string;
      source_url?: string;
      note_status?: string;
      search_results?: string;
      check_reasoning?: string;
      logs?: Record<string, unknown>;
      cost?: number;
    }
  ): Promise<void> {
    const { error } = await this.client
      .from("pipeline_runs")
      // Strip NUL characters from every free-text and JSONB field. Model output
      // can contain U+0000, for example when Gemini reads text out of an image.
      // Postgres rejects such a string with error 22P05, and that would lose the
      // whole run's row, including its logs and its outcome.
      .update(stripNullChars({
        outcome: data.outcome,
        outcome_reason: data.outcome_reason,
        error_message: data.error_message,
        warnings: data.warnings,
        final_stage: data.final_stage,
        note_id: data.note_id,
        bot_name: data.bot_name,
        ab_test_picks: data.ab_test_picks,
        bot_config: data.bot_config,
        note_text: data.note_text,
        source_url: data.source_url,
        note_status: data.note_status,
        search_results: data.search_results,
        check_reasoning: data.check_reasoning,
        logs: data.logs,
        cost: data.cost,
      }))
      .eq("id", runId);

    if (error) {
      console.error("[SupabaseLogger] Error completing pipeline run:", error);
      throw error;
    }
  }

  async addPipelineScore(
    runId: string,
    data: {
      score_type: string;
      score_value?: number;
      score_label?: string;
      score_metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    const { error } = await this.client.from("pipeline_scores").insert({
      pipeline_run_id: runId,
      score_type: data.score_type,
      score_value: data.score_value,
      score_label: data.score_label,
      score_metadata: data.score_metadata,
    });

    if (error) {
      console.error("[SupabaseLogger] Error adding pipeline score:", error);
      throw error;
    }
  }

  /**
   * Marks every run that is still `in_progress` and older than
   * `olderThanMinutes` as failed. A row like that is left behind when
   * processTweet's final `completePipelineRun` call threw. Without this sweep
   * those rows would stay `in_progress` forever and would distort every
   * outcome-rate calculation.
   */
  async sweepStuckRuns(opts: { olderThanMinutes: number }): Promise<number> {
    const cutoff = new Date(Date.now() - opts.olderThanMinutes * 60_000).toISOString();
    const { data, error } = await this.client
      .from("pipeline_runs")
      .update({
        outcome: "failed",
        outcome_reason: "not_completed",
        error_message: `Run did not finish (sweeper marked failed after ${opts.olderThanMinutes} min)`,
        final_stage: "error",
      })
      .eq("outcome", "in_progress")
      .lt("created_at", cutoff)
      .select("id");

    if (error) {
      console.error("[SupabaseLogger] Error sweeping stuck runs:", error);
      throw error;
    }
    return data?.length ?? 0;
  }

  async markCandidateSubmitted(runId: string, noteId: string): Promise<void> {
    const { error } = await this.client
      .from("pipeline_runs")
      .update({
        outcome: "submitted",
        final_stage: "submission",
        note_id: noteId,
      })
      .eq("id", runId);

    if (error) {
      console.error("[SupabaseLogger] Error marking candidate submitted:", error);
      throw error;
    }
  }

  /**
   * Marks a pipeline run as expired. That happens when the tweet was deleted or
   * became ineligible while we were submitting the note.
   */
  async markCandidateExpired(runId: string, reason: string): Promise<void> {
    const { error } = await this.client
      .from("pipeline_runs")
      .update({
        outcome: "rejected",
        outcome_reason: reason,
        final_stage: "submission",
      })
      .eq("id", runId);

    if (error) {
      console.error("[SupabaseLogger] Error marking candidate expired:", error);
      throw error;
    }
  }

  /**
   * Returns the tweet ids the pipeline should skip. A tweet we already wrote a
   * note for is always skipped. A tweet that was rejected before is skipped for
   * a cooldown period that grows with the number of rejections. One rejection
   * means one hour. Two rejections mean 24 hours. Three or more rejections mean
   * the tweet is skipped for good.
   */
  async getSkipTweetIds(): Promise<Set<string>> {
    const tweetIds = new Set<string>();

    try {
      const notesData = await this.fetchAllRows<{ note_id: string; tweet_id: string }>(
        (client) => client.from("notes").select("note_id, tweet_id"),
        "note_id",
        "getSkipTweetIds.notes",
      );
      notesData.forEach((row) => {
        if (row.tweet_id) tweetIds.add(row.tweet_id);
      });

      try {
        const pipelineData = await this.fetchAllRows<{ id: string; tweet_id: string; created_at: string }>(
          (client) => client.from("pipeline_runs").select("id, tweet_id, created_at")
            .eq("outcome", "rejected"),
          "id",
          "getSkipTweetIds.rejected",
        );
        const rejectionInfo = new Map<string, { count: number; latestAt: Date }>();
        for (const row of pipelineData) {
          if (!row.tweet_id) continue;
          const ts = new Date(row.created_at);
          const existing = rejectionInfo.get(row.tweet_id);
          if (!existing) {
            rejectionInfo.set(row.tweet_id, { count: 1, latestAt: ts });
          } else {
            existing.count++;
            if (ts > existing.latestAt) existing.latestAt = ts;
          }
        }

        const now = new Date();
        for (const [tweetId, info] of rejectionInfo) {
          if (info.count >= 3) {
            tweetIds.add(tweetId);
          } else {
            const hoursSinceLatest = (now.getTime() - info.latestAt.getTime()) / (1000 * 60 * 60);
            const cooldownHours = info.count === 1 ? 1 : 24;
            if (hoursSinceLatest < cooldownHours) {
              tweetIds.add(tweetId);
            }
          }
        }
      } catch (pipelineError) {
        console.error("[SupabaseLogger] Error fetching pipeline runs:", pipelineError);
      }

      return tweetIds;
    } catch (error) {
      console.error("[SupabaseLogger] Error fetching processed tweet IDs:", error);
      return new Set();
    }
  }

  /**
   * Returns every tweet id that is already in the tweets table. Those are the
   * tweets we have seen before from the eligibility endpoint. The caller uses
   * the set to skip them, so each fetched tweet is processed at most once.
   */
  async getKnownTweetIds(): Promise<Set<string>> {
    try {
      // We page by tweet_id. The tweets table holds more than 40,000 rows and
      // keeps growing roughly in step with the number of pipeline runs. tweet_id
      // is the primary key, so it is unique and indexed and makes a natural
      // paging key.
      const rows = await this.fetchAllRows<{ tweet_id: string }>(
        (client) => client.from("tweets").select("tweet_id"),
        "tweet_id",
        "getKnownTweetIds",
      );
      return new Set(rows.map((r) => r.tweet_id).filter(Boolean));
    } catch (error) {
      console.error("[SupabaseLogger] Error fetching known tweet IDs:", error);
      return new Set();
    }
  }

  // ============================================
  // Misinfo monitoring sightings (XXL-feed pre-pass)
  // ============================================

  /**
   * Returns the tweet ids that have already been run through Pangram, whatever
   * the verdict was. It costs one read per run, and it lets the Pangram pre-pass
   * check each long-form post exactly once instead of classifying the same viral
   * post again on every run. On any error it returns an empty set instead of
   * throwing. That way the pre-pass still works before migration 049 has been
   * applied. It simply checks the posts again.
   */
  async getPangramCheckedTweetIds(): Promise<Set<string>> {
    try {
      const rows = await this.fetchAllRows<{ tweet_id: string }>(
        (client) => client.from("pangram_monitoring_sightings").select("tweet_id"),
        "tweet_id",
        "getPangramCheckedTweetIds",
      );
      return new Set(rows.map((r) => r.tweet_id));
    } catch (err) {
      console.warn("[SupabaseLogger] getPangramCheckedTweetIds failed (table missing?):", err);
      return new Set();
    }
  }

  /** Records Pangram verdicts. The write only inserts, so the first verdict we
   *  store for a tweet is the one that is kept. */
  async recordPangramChecks(rows: Array<{
    tweet_id: string;
    feed_size?: string;
    impression_count?: number;
    author_name?: string;
    prediction_short: string;
    fraction_ai?: number;
    is_ai: boolean;
    processed_run_id?: string;
  }>): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.client
      .from("pangram_monitoring_sightings")
      .upsert(rows, { onConflict: "tweet_id", ignoreDuplicates: true });
    if (error) {
      console.error("[SupabaseLogger] Error recording pangram checks:", error);
      throw error;
    }
  }

  /**
   * Returns every sighting that already has a verdict, keyed as
   * "<tweetId>:<topicId>". It costs one read per pass. With that set a caller
   * can tell which keyword-matched posts are new, and only those are worth
   * upserting and sending to the selection LLM.
   *
   * Rows whose needs_note is null are left out on purpose. Such a row was
   * upserted, but the selection LLM never returned a verdict for it, for example
   * because it crashed after the upsert. Treating those rows as seen would drop
   * them forever. Leaving them out lets the next run judge them again. That is
   * what the sightings-first ordering is for, and it is what the partial index
   * on needs_note IS NULL in migration 043 anticipated.
   *
   * The table grows without bound and this call pages through all of it. That is
   * fine at the current size. Revisit it if the reads get slow.
   */
  async getMisinfoSightingKeys(): Promise<Set<string>> {
    const rows = await this.fetchAllRows<{ tweet_id: string; topic_id: string }>(
      (client) => client
        .from("misinfo_monitoring_sightings")
        .select("id, tweet_id, topic_id")
        .not("needs_note", "is", null),
      "id",
      "getMisinfoSightingKeys",
    );
    return new Set(rows.map((r) => `${r.tweet_id}:${r.topic_id}`));
  }

  /**
   * Returns the sightings that the selection LLM judged note-worthy but that
   * were never processed, keyed as "<tweetId>:<topicId>". Those are the rows
   * where needs_note is true and processed_run_id is null, which is the
   * predicate the partial index from migration 043 serves. When such a post
   * shows up again in a later fetch, the stored verdict is reused instead of
   * paying for another selection-LLM call.
   */
  async getPendingMisinfoSightings(topicIds: string[]): Promise<Set<string>> {
    if (!topicIds.length) return new Set();
    const rows = await this.fetchAllRows<{ tweet_id: string; topic_id: string }>(
      (client) => client
        .from("misinfo_monitoring_sightings")
        .select("id, tweet_id, topic_id")
        .eq("needs_note", true)
        .is("processed_run_id", null)
        .in("topic_id", topicIds),
      "id",
      "getPendingMisinfoSightings",
    );
    return new Set(rows.map((r) => `${r.tweet_id}:${r.topic_id}`));
  }

  /** Inserts newly matched sightings. A tweet and topic pair that already has a
   *  row is ignored. */
  async upsertMisinfoSightings(rows: Array<{
    tweet_id: string;
    topic_id: string;
    feed_size: string;
    impression_count?: number;
    author_name?: string;
  }>): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.client
      .from("misinfo_monitoring_sightings")
      .upsert(rows, { onConflict: "tweet_id,topic_id", ignoreDuplicates: true });
    if (error) {
      console.error("[SupabaseLogger] Error upserting misinfo sightings:", error);
      throw error;
    }
  }

  /** Write back the selection LLM's verdict for a batch of sightings. */
  async recordMisinfoVerdicts(updates: Array<{
    tweet_id: string;
    topic_id: string;
    needs_note: boolean;
    selection_reason?: string;
  }>): Promise<void> {
    const evaluatedAt = new Date().toISOString();
    for (const u of updates) {
      const { error } = await this.client
        .from("misinfo_monitoring_sightings")
        .update({ needs_note: u.needs_note, selection_reason: u.selection_reason, evaluated_at: evaluatedAt })
        .eq("tweet_id", u.tweet_id)
        .eq("topic_id", u.topic_id);
      if (error) {
        console.error("[SupabaseLogger] Error recording misinfo verdict:", error);
        throw error;
      }
    }
  }

  /** Stamp a sighting as processed once its pre-pass pipeline run completes. */
  async markMisinfoProcessed(tweetId: string, topicId: string, runId: string): Promise<void> {
    const { error } = await this.client
      .from("misinfo_monitoring_sightings")
      .update({ processed_run_id: runId, processed_at: new Date().toISOString() })
      .eq("tweet_id", tweetId)
      .eq("topic_id", topicId);
    if (error) {
      console.error("[SupabaseLogger] Error marking misinfo sighting processed:", error);
      throw error;
    }
  }

  /**
   * Returns summary statistics over all scraped notewriter notes, taken from the
   * reconciled rows in `notes`. Notes in the junk data tier are left out. Notes
   * that predate bot tracking are included.
   */
  async getScrapedNoteSummary(): Promise<{ totalNotes: number; totalViews: number; totalHelpful: number; totalNotHelpful: number; totalNeedsMore: number }> {
    const notes = await this.fetchAllRows<{
      note_id: string;
      view_count: number | null;
      cn_status: string | null;
      data_tier: string | null;
    }>(
      (client) => client.from("notes")
        .select("note_id, view_count, cn_status, data_tier")
        .neq("data_tier", "junk"),
      "note_id",
      "getScrapedNoteSummary",
    );

    let totalViews = 0, totalHelpful = 0, totalNotHelpful = 0, totalNeedsMore = 0;
    for (const note of notes) {
      totalViews += note.view_count || 0;
      const s = (note.cn_status || "").toUpperCase().replace(/\s+/g, "_");
      if (s === "CURRENTLY_RATED_HELPFUL") totalHelpful++;
      else if (s === "CURRENTLY_RATED_NOT_HELPFUL") totalNotHelpful++;
      else if (s === "NEEDS_MORE_RATINGS") totalNeedsMore++;
    }

    return { totalNotes: notes.length, totalViews, totalHelpful, totalNotHelpful, totalNeedsMore };
  }

  /**
   * Derives the canonical tweet_id of each scraped note by letting its snapshots
   * vote.
   *
   * Every note goes through the same steps. We collect the non-null tweet_ids
   * from all of its snapshots. The id with the most votes wins. If that winner
   * holds at least two thirds of the votes and does not contradict the tweet_id
   * the `notes` row already carries, we clear tweet_id_flag. Otherwise we set
   * tweet_id_flag to the reason. We write the winner into notes.tweet_id only
   * when it holds at least two thirds of the votes.
   *
   * Returns summary statistics.
   */
  async deriveTweetIds(): Promise<{ total: number; updated: number; flagged: number; noVotes: number }> {
    // Step 1. Read every snapshot together with its tweet_id. The paging key is
    // the snapshot id primary key.
    const snapshots = await this.fetchAllRows<{ id: string; note_id: string; tweet_id: string | null }>(
      (client) => client.from("scraped_notewriter_snapshots")
        .select("id, note_id, tweet_id"),
      "id",
      "deriveTweetIds.snapshots",
    );

    // Step 2. Read the notes the vote is computed for.
    const scrapedNotes = await this.fetchAllRows<{ note_id: string; tweet_id: string }>(
      (client) => client.from("notes")
        .select("note_id, tweet_id"),
      "note_id",
      "deriveTweetIds.scrapedNotes",
    );

    // Step 3. Read the tweet_id that the notes table already holds. Migration
    // 034 merged the bot's submission rows into this same table, so these are
    // the same rows as in step 2. The values serve as the reference the snapshot
    // vote has to agree with.
    const botNotes = await this.fetchAllRows<{ note_id: string; tweet_id: string }>(
      (client) => client.from("notes")
        .select("note_id, tweet_id"),
      "note_id",
      "deriveTweetIds.botNotes",
    );
    const botTweetIds = new Map<string, string>();
    for (const n of botNotes) {
      if (n.note_id && n.tweet_id) botTweetIds.set(n.note_id, n.tweet_id);
    }

    // Step 4. Tally the votes for each note.
    const votesPerNote = new Map<string, Map<string, number>>();
    for (const snap of snapshots) {
      if (!snap.tweet_id) continue;
      if (!votesPerNote.has(snap.note_id)) votesPerNote.set(snap.note_id, new Map());
      const tally = votesPerNote.get(snap.note_id)!;
      tally.set(snap.tweet_id, (tally.get(snap.tweet_id) || 0) + 1);
    }

    // Step 5. Work out the winner for each note and flag the doubtful cases.
    let updated = 0, flagged = 0, noVotes = 0;

    for (const note of scrapedNotes) {
      const tally = votesPerNote.get(note.note_id);

      if (!tally || tally.size === 0) {
        noVotes++;
        continue;
      }

      const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      const [winnerTweetId, winnerCount] = sorted[0]!;
      const totalVotes = [...tally.values()].reduce((a, b) => a + b, 0);
      const winnerShare = winnerCount / totalVotes;

      const botTweetId = botTweetIds.get(note.note_id);
      const hasSuperMajority = winnerShare >= 2 / 3;
      const matchesBot = !botTweetId || botTweetId === winnerTweetId;

      let flag: string | null = null;
      if (!hasSuperMajority) {
        flag = `split:${sorted.map(([id, c]) => `${id.slice(-6)}=${c}`).join("/")}`;
      } else if (!matchesBot) {
        flag = `disagrees_with_notes_table:snapshots=${winnerTweetId},notes=${botTweetId}`;
      }

      // We only write when the winner differs from the stored tweet_id, or when
      // there is a flag to record. A row that already holds the winning id and
      // gets no flag is left untouched, so a flag set by an earlier run is never
      // cleared on such a row.
      const needsUpdate = winnerTweetId !== note.tweet_id || flag !== null;
      if (needsUpdate) {
        const updateData: Record<string, any> = { tweet_id_flag: flag };
        if (hasSuperMajority) {
          updateData.tweet_id = winnerTweetId;
        }
        const { error } = await this.client
          .from("notes")
          .update(updateData)
          .eq("note_id", note.note_id);
        if (error) {
          console.error(`[deriveTweetIds] Error updating ${note.note_id}:`, error);
        } else {
          updated++;
        }
      }

      if (flag) flagged++;
    }

    return { total: scrapedNotes.length, updated, flagged, noVotes };
  }

  /**
   * Looks for signs that a scrape recorded the wrong data for a note. Both
   * checks catch the same underlying problem. X's virtualized list can hand the
   * scraper the contents of another note's cell.
   *
   * The first check reports a view count that fell below the highest count we
   * have seen for that note. A view count only ever goes up.
   *
   * The second check reports a note whose text changed between two snapshots.
   * Note text cannot be edited on X.
   *
   * Returns every anomaly it found.
   */
  async detectSnapshotAnomalies(): Promise<{
    viewCountDecreases: Array<{ note_id: string; from: number; to: number; fromDate: string; toDate: string }>;
    noteTextChanges: Array<{ note_id: string; texts: string[]; dates: string[] }>;
  }> {
    // Keyset pagination returns the rows ordered by id, so the scraped_at order
    // is lost here. Each note's group is sorted by scraped_at again below.
    const snapshots = await this.fetchAllRows<{
      id: string;
      note_id: string;
      view_count: number | null;
      note_text: string | null;
      cn_status: string | null;
      scraped_at: string;
    }>(
      (client) => client.from("scraped_notewriter_snapshots")
        .select("id, note_id, view_count, note_text, cn_status, scraped_at"),
      "id",
      "detectSnapshotAnomalies",
    );

    const byNote = new Map<string, typeof snapshots>();
    for (const snap of snapshots) {
      if (!byNote.has(snap.note_id)) byNote.set(snap.note_id, []);
      byNote.get(snap.note_id)!.push(snap);
    }
    for (const noteSnaps of byNote.values()) {
      noteSnaps.sort((a, b) => a.scraped_at.localeCompare(b.scraped_at));
    }

    const viewCountDecreases: Array<{ note_id: string; from: number; to: number; fromDate: string; toDate: string }> = [];
    const noteTextChanges: Array<{ note_id: string; texts: string[]; dates: string[] }> = [];

    for (const [noteId, noteSnaps] of byNote) {
      // First check. A view count that fell below the highest one seen so far.
      let maxViewsSeen = 0;
      for (const snap of noteSnaps) {
        const views = snap.view_count || 0;
        if (views > 0 && views < maxViewsSeen) {
          viewCountDecreases.push({
            note_id: noteId,
            from: maxViewsSeen,
            to: views,
            fromDate: noteSnaps.find(s => (s.view_count || 0) === maxViewsSeen)?.scraped_at.slice(0, 10) || "?",
            toDate: snap.scraped_at.slice(0, 10),
          });
        }
        if (views > maxViewsSeen) maxViewsSeen = views;
      }

      // Second check. Note text that changed. Only snapshots that carry more
      // than ten characters of text take part, so an empty or truncated cell
      // does not count as a change.
      const withText = noteSnaps.filter(s => s.note_text && s.note_text.length > 10);
      if (withText.length >= 2) {
        const uniqueTexts = new Set(withText.map(s => s.note_text!));
        if (uniqueTexts.size > 1) {
          noteTextChanges.push({
            note_id: noteId,
            texts: [...uniqueTexts].map(t => t.slice(0, 100)),
            dates: withText.map(s => s.scraped_at.slice(0, 10)),
          });
        }
      }
    }

    return { viewCountDecreases, noteTextChanges };
  }

  /** Inserts a snapshot taken from X's public Community Notes data dump. */
  async insertPublicDataSnapshot(snapshot: Omit<PublicDataSnapshot, "id" | "created_at">): Promise<void> {
    // This is an upsert so that a later dump can fill in note_text on a row that
    // was stored without it.
    const { error } = await this.client
      .from("public_data_snapshots")
      .upsert(snapshot, {
        onConflict: "note_id,snapshot_date",
        ignoreDuplicates: false,
      });

    if (error) {
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Pipeline state (key-value store for persistent state across runs)
  // ---------------------------------------------------------------------------

  async getPipelineState(key: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("pipeline_state")
      .select("value")
      .eq("key", key)
      .single();
    if (error || !data) return null;
    return data.value;
  }

  async setPipelineState(key: string, value: string): Promise<void> {
    const { error } = await this.client
      .from("pipeline_state")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) {
      console.warn(`[SupabaseLogger] Failed to set pipeline state ${key}:`, error.message);
    }
  }

  private isRetryableCountError(status: number, error: CountError | null): boolean {
    const code = error?.code ?? "";
    return RETRYABLE_COUNT_STATUSES.has(status) || status >= 500 || code.startsWith("08") || code === "57014";
  }

  private formatCountError(status: number, error: CountError | null): string {
    if (!error) return `HTTP ${status}: unknown error`;

    const parts = [`HTTP ${status}`];
    if (error.code) parts.push(error.code);
    if (error.message) parts.push(error.message);
    if (error.details) parts.push(`details=${error.details}`);
    if (error.hint) parts.push(`hint=${error.hint}`);

    if (parts.length > 1) return parts.join(": ");
    return `HTTP ${status}: ${JSON.stringify(error)}`;
  }

  private errorToCountResponse(err: unknown): ExactCountResponse {
    const anyErr = err as any;
    return {
      count: null,
      error: {
        message: anyErr?.message ?? String(err),
        code: anyErr?.code,
        details: anyErr?.details,
        hint: anyErr?.hint,
      },
      status: anyErr?.status ?? anyErr?.statusCode ?? 0,
    };
  }

  private async settleCountQuery(query: PromiseLike<ExactCountResponse>): Promise<ExactCountResponse> {
    try {
      return await query;
    } catch (err) {
      return this.errorToCountResponse(err);
    }
  }

  /**
   * Runs an exact count as a HEAD request, with retries. When it still fails it
   * logs the error and returns 0.
   *
   * A HEAD response has no body, so the HTTP status is the only thing we learn
   * when the request fails. Failures that look transient are retried. Those are
   * network errors, 5xx statuses and timeouts. Once the retries are used up, the
   * same count runs once more as a GET that fetches a single row. That either
   * succeeds or gives us the real PostgREST error body.
   */
  private async runExactCount(makeQuery: ExactCountQuery, label: string): Promise<number> {
    const maxAttempts = COUNT_RETRY_DELAYS_MS.length + 1;
    let lastFailure: ExactCountResponse | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await this.settleCountQuery(makeQuery(true));
      if (!result.error) {
        if (attempt > 1) {
          console.warn(`[SupabaseLogger] Count ${label} succeeded on attempt ${attempt}/${maxAttempts}`);
        }
        return result.count ?? 0;
      }

      lastFailure = result;
      const retryDelay = COUNT_RETRY_DELAYS_MS[attempt - 1];
      if (!retryDelay || !this.isRetryableCountError(result.status, result.error)) break;

      console.warn(
        `[SupabaseLogger] Failed to count ${label} (${this.formatCountError(result.status, result.error)}), ` +
          `retrying in ${retryDelay}ms (attempt ${attempt}/${maxAttempts})`,
      );
      await sleep(retryDelay);
    }

    const headFailure = this.formatCountError(lastFailure!.status, lastFailure!.error);
    const fallback = await this.settleCountQuery(makeQuery(false));
    if (!fallback.error) {
      console.warn(`[SupabaseLogger] Count ${label} recovered via GET fallback after HEAD failure: ${headFailure}`);
      return fallback.count ?? 0;
    }

    console.warn(
      `[SupabaseLogger] Failed to count ${label}: HEAD ${headFailure}; ` +
        `GET fallback ${this.formatCountError(fallback.status, fallback.error)}`,
    );
    return 0;
  }

  async countRecentSubmissions(hours: number): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    return this.runExactCount(
      (head) => this.client.from("notes").select("id", { count: "exact", head }).gte("submitted_at", since).limit(1),
      "recent submissions",
    );
  }

  /**
   * Counts the misinfo-monitoring notes we submitted in the last `hours`. The
   * number bounds the reserve that gives misinfo notes priority at submit time,
   * see submitCandidates.
   *
   * A misinfo note is found by taking the sightings that were processed in a
   * slightly wider window and keeping those whose tweet we actually submitted a
   * note for. Going through the sightings means that a curated-topic post the
   * regular pass found counts too, not only the ones the pre-pass found.
   *
   * A query error is thrown rather than swallowed. The caller then falls back to
   * giving no priority at all, which is the safe direction.
   */
  async countRecentMisinfoSubmissions(hours: number): Promise<number> {
    const submitSince = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    // A note submitted inside the window was processed at roughly the same time.
    // The processed-at window is a little wider so that a note submitted moments
    // ago is never missed.
    const processedSince = new Date(Date.now() - (hours + 2) * 60 * 60 * 1000).toISOString();
    const { data: sightings, error: sErr } = await this.client
      .from("misinfo_monitoring_sightings")
      .select("tweet_id")
      .not("processed_run_id", "is", null)
      .gte("processed_at", processedSince);
    if (sErr) throw sErr;
    const tweetIds = [...new Set((sightings ?? []).map((s) => String((s as { tweet_id: string }).tweet_id)))];
    if (tweetIds.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < tweetIds.length; i += 200) {
      const { count, error } = await this.client
        .from("notes")
        .select("id", { count: "exact", head: true })
        .in("tweet_id", tweetIds.slice(i, i + 200))
        .gte("submitted_at", submitSince);
      if (error) throw error;
      total += count ?? 0;
    }
    return total;
  }

  async countRecentPipelineRuns(hours: number): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    return this.runExactCount(
      (head) =>
        this.client.from("pipeline_runs").select("id", { count: "exact", head }).gte("created_at", since).limit(1),
      "recent pipeline runs",
    );
  }

  async countRecentPipelineRunsByOutcomes(hours: number, outcomes: string[]): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    return this.runExactCount(
      (head) =>
        this.client
          .from("pipeline_runs")
          .select("id", { count: "exact", head })
          .gte("created_at", since)
          .in("outcome", outcomes)
          .limit(1),
      "recent pipeline runs by outcome",
    );
  }
}
