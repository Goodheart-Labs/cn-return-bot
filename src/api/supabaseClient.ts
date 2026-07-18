import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows as fetchAllRowsShared } from "./paging";
import type { Post } from "./fetchEligiblePosts";
import { stripNullChars } from "../utils/stripNullChars";

// A note that an --incremental scrape scrolled past without capturing this many
// times is "given up": excluded from the anchor so a permanently-deleted note
// can't pin the daily window. The staged updates in markIncrementalMisses assume 2.
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

// Merged shape after migration 034: notes is the master record per note,
// with submission metadata (notewriter_id / submitted_at) nullable for
// pre-tracking rows and rating/status fields populated from public data.
// For run/bot/score data, join notes.note_id → pipeline_runs.note_id.
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

// Insert payload for logNoteSubmission: only the columns the submission
// pipeline actually knows. Status/ratings/views get filled in later by the
// updateNoteFeedback cron and the scraper.
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

// Builds the count query. head:true is the normal body-less request; head:false
// is the diagnostic GET fallback (error bodies only survive on GET). Builders
// should append .limit(1) — a no-op on HEAD — so the fallback fetches one row.
type ExactCountQuery = (head: boolean) => PromiseLike<ExactCountResponse>;

const COUNT_RETRY_DELAYS_MS = [250, 1000] as const;
// status 0 = network-level failure (supabase-js resolves with no HTTP status)
const RETRYABLE_COUNT_STATUSES = new Set([0, 408, 425, 429]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns the singleton supabase-js client.
 *
 * Heads-up for callers writing new queries: PostgREST silently caps any
 * single `.select()` response at 1000 rows. There's no error if your
 * result is larger — it just gets truncated. To fetch everything matching
 * a query, use `fetchAllRows` from ./paging (keyset-paginated, handles
 * arbitrarily large result sets). Bounded queries with `.limit(N)` or
 * `.single()` are fine to call directly on this client.
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

// Rows with raw_tweet blobs are large — keep write batches small enough that a
// single PostgREST request stays well under body-size/time limits.
const FEED_TWEETS_WRITE_CHUNK = 500;

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Map an eligibility-endpoint Post to the shared column shape of the `tweets`
 * and `feed_tweets` tables. Derives has_video / has_photo / media_count /
 * video_duration_ms from post.media and carries the complete raw X-API object
 * in raw_tweet. Table-specific timestamps are added by the callers.
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
   * Fetch every row matching `buildQuery()`. Delegates to the shared keyset
   * paginator in src/api/paging.ts. Caller must supply a unique, indexed
   * `keyCol` (typically the table's primary key).
   */
  async fetchAllRows<T extends Record<string, any>>(
    buildQuery: (from: SupabaseClient) => any,
    keyCol: string,
    label?: string,
  ): Promise<T[]> {
    return fetchAllRowsShared<T>(() => buildQuery(this.client), keyCol, { label });
  }

  /**
   * Upsert the notes row after a successful submission. Upsert (not insert)
   * because the scraper may have already created a row with cn_status / view_count
   * before we landed the API response — we want to enrich that row with the
   * submission metadata, not crash on the unique-constraint violation.
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

  /**
   * Get or create a notewriter by handle
   */
  async getOrCreateNotewriter(handle: string, displayName?: string): Promise<Notewriter> {
    // Try to find existing
    const { data: existing } = await this.client
      .from("notewriters")
      .select()
      .eq("handle", handle)
      .single();

    if (existing) {
      return existing;
    }

    // Create new
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

  /**
   * Find a scraped note by tweet_id and return its current note_id
   */
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
   * Update a scraped note's note_id (e.g., from tweet_XXXX placeholder to real ID)
   * Also updates any snapshots that reference the old note_id
   */
  async updateScrapedNoteId(oldNoteId: string, newNoteId: string): Promise<void> {
    // Single UPDATE on notes; the FK on scraped_notewriter_snapshots.note_id
    // is ON UPDATE CASCADE (migration 036), so dependent snapshot rows are
    // renamed in the same transaction.
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
   * Get scraped note IDs in a given range (for coverage checks)
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
   * Existence + first-snapshot state for a note in a single read. Lets the
   * scraper decide whether to create the note row and whether it still needs its
   * `first_snapshot_at` stamped, without an extra round-trip.
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
   * Stamp when a note first received a scraper snapshot. Idempotent — only sets
   * the value while it is still null. This is what makes getOldestUnscrapedNoteId
   * a cheap indexed lookup instead of a scan of the whole snapshots time-series.
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
   * Oldest known note that is still eligible to anchor the --incremental scrape:
   * no snapshot yet (`first_snapshot_at IS NULL`) and not given up after repeated
   * misses (`scrape_misses < MISS_LIMIT`). `first_snapshot_at` is stamped on a
   * note's first snapshot (see markFirstSnapshot + migration 048) and this exact
   * predicate is backed by the partial index `idx_notes_incremental_anchor`, so
   * it's a cheap indexed read rather than a scan of the snapshots time-series.
   * Returns null when every known note has a snapshot or has been given up.
   */
  async getOldestUnscrapedNoteId(): Promise<string | null> {
    // note_id is text so .order() is lexicographic; take the smallest window and
    // pick the true min as a BigInt to guard against any mixed-length ids.
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
   * After an --incremental run, account for notes the scrape scrolled past but
   * failed to capture — still no snapshot and note_id >= the lowest captured id.
   * Implements a MISS_LIMIT-miss give-up with two ordered literal-set updates (no
   * column arithmetic, so no RPC needed): first promote already-missed notes to
   * MISS_LIMIT (given up), then record a first miss for the rest. The order avoids
   * giving up on a note in the same run it was first missed. A captured note has
   * first_snapshot_at set and so drops out of this set, making misses effectively
   * consecutive. Returns counts for logging.
   */
  async markIncrementalMisses(minCoveredNoteId: string): Promise<{ givenUp: number; firstMisses: number }> {
    const coveredUnscraped = (q: any) =>
      q.is("first_snapshot_at", null)
        .gte("note_id", minCoveredNoteId)
        .not("note_id", "like", "tweet_%")
        .not("note_id", "like", "unavailable_%");

    // 1. Missed before and missed again → give up.
    const { data: givenUp, error: giveUpErr } = await coveredUnscraped(
      this.client.from("notes").update({ scrape_misses: MISS_LIMIT }),
    )
      .eq("scrape_misses", MISS_LIMIT - 1)
      .select("note_id");
    if (giveUpErr) {
      console.error("[SupabaseLogger] Error giving up on unscrapable notes:", giveUpErr);
      throw giveUpErr;
    }

    // 2. First miss for notes never missed before.
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
   * Bulk insert tweets from fetched eligibility-endpoint posts.
   * Insert-only: rows whose tweet_id already exists are skipped, so engagement
   * metrics remain frozen at first sight.
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
   * Save every post from a full eligible-feed pull into feed_tweets.
   * First-seen tweets get a full row (incl. the large raw_tweet blob);
   * already-known tweets get only their engagement metrics, author counts and
   * last_seen_at refreshed — the big JSONB/text columns are never rewritten.
   * Returns { inserted, updated } for run logging.
   */
  async bulkSaveFeedTweets(posts: Post[]): Promise<{ inserted: number; updated: number }> {
    if (!posts.length) return { inserted: 0, updated: 0 };
    const now = new Date().toISOString();

    // Pass 1: insert full rows for tweets not seen before (DO NOTHING on
    // conflict); .select() returns only the actually-inserted rows.
    const insertedIds = new Set<string>();
    const fullRows = posts.map((post) => ({ ...postToTweetRow(post), first_seen_at: now, last_seen_at: now }));
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

    // Pass 2: for the pre-existing rest, refresh only the volatile columns.
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
   * Create a new pipeline run record when a tweet starts processing
   * Returns the run ID to attach scores to later
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
        outcome: "in_progress", // Will be updated when pipeline completes
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

  /**
   * Update pipeline run with final outcome
   */
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
      // Scrub NUL chars from every free-text / JSONB field — model output (e.g.
      // Gemini media OCR) can emit U+0000, which Postgres rejects with 22P05 and
      // would otherwise drop the whole run's row (logs + outcome).
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

  /**
   * Add a score to a pipeline run
   */
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
   * Mark any `in_progress` runs older than `olderThanMinutes` as failed.
   * Catches rows where processTweet's terminal `completePipelineRun` call
   * itself threw — without this, those rows stay `in_progress` forever
   * and pollute outcome-rate calculations.
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

  /**
   * Mark a candidate as submitted after successful note submission.
   */
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
   * Mark a pipeline run as expired (tweet deleted or ineligible during submission).
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
   * Get tweet IDs to skip, with cooldown logic for retries.
   * - Submitted notes: always skip
   * - All rejections: 1h after 1st, 24h after 2nd, permanent after 3+
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
   * Get all tweet IDs already in the tweets table — i.e. tweets we have
   * previously seen from the eligibility endpoint. Used to skip already-seen
   * tweets so each fetched tweet is processed at most once.
   */
  async getKnownTweetIds(): Promise<Set<string>> {
    try {
      // Keyset by tweet_id: the tweets table has 40k+ rows and grows roughly
      // linearly with pipeline runs. tweet_id is the primary key so it's
      // unique, indexed, and a natural pagination key.
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
   * Tweet IDs already run through Pangram (any verdict). One read per run so the
   * Pangram pre-pass checks each long-form post exactly once instead of
   * re-classifying the same viral post every run. Fail-soft to an empty set so
   * the pre-pass still runs before migration 049 is applied (it just re-checks).
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

  /** Record Pangram verdicts (insert-only; the first verdict per tweet wins). */
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
   * All sightings recorded so far, keyed "<tweetId>:<topicId>". One read per
   * run so the pre-pass can tell which keyword-matched posts are *new* (worth
   * upserting + evaluating with the selection LLM) versus already-seen.
   */
  async getMisinfoSightingKeys(): Promise<Set<string>> {
    const rows = await this.fetchAllRows<{ tweet_id: string; topic_id: string }>(
      (client) => client.from("misinfo_monitoring_sightings").select("id, tweet_id, topic_id"),
      "id",
      "getMisinfoSightingKeys",
    );
    return new Set(rows.map((r) => `${r.tweet_id}:${r.topic_id}`));
  }

  /** Insert newly-matched sightings; existing (tweet, topic) pairs are ignored. */
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
   * Get summary stats across ALL scraped notewriter notes using reconciled data.
   * Excludes junk-tier notes. Includes notes that predate bot tracking.
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
   * Derive canonical tweet_ids for scraped notes using snapshot majority vote.
   *
   * For each note_id in notes:
   * - Collect all non-null tweet_ids from its snapshots
   * - If the top tweet_id has >= 2/3 of votes AND matches the `notes` table (if entry exists), clear the flag
   * - Otherwise, set tweet_id_flag with the reason
   * - Update notes.tweet_id to the majority winner (if there is one)
   *
   * Returns summary stats.
   */
  async deriveTweetIds(): Promise<{ total: number; updated: number; flagged: number; noVotes: number }> {
    // 1. Get all snapshots with tweet_id (paginate by snapshot id PK).
    const snapshots = await this.fetchAllRows<{ id: string; note_id: string; tweet_id: string | null }>(
      (client) => client.from("scraped_notewriter_snapshots")
        .select("id, note_id, tweet_id"),
      "id",
      "deriveTweetIds.snapshots",
    );

    // 2. Get all scraped notes
    const scrapedNotes = await this.fetchAllRows<{ note_id: string; tweet_id: string }>(
      (client) => client.from("notes")
        .select("note_id, tweet_id"),
      "note_id",
      "deriveTweetIds.scrapedNotes",
    );

    // 3. Get bot-submitted notes (source of truth for tweet_id)
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

    // 4. Build vote tallies per note_id
    const votesPerNote = new Map<string, Map<string, number>>();
    for (const snap of snapshots) {
      if (!snap.tweet_id) continue;
      if (!votesPerNote.has(snap.note_id)) votesPerNote.set(snap.note_id, new Map());
      const tally = votesPerNote.get(snap.note_id)!;
      tally.set(snap.tweet_id, (tally.get(snap.tweet_id) || 0) + 1);
    }

    // 5. For each scraped note, compute majority and flag
    let updated = 0, flagged = 0, noVotes = 0;

    for (const note of scrapedNotes) {
      const tally = votesPerNote.get(note.note_id);

      if (!tally || tally.size === 0) {
        noVotes++;
        continue;
      }

      // Find the winner
      const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      const [winnerTweetId, winnerCount] = sorted[0]!;
      const totalVotes = [...tally.values()].reduce((a, b) => a + b, 0);
      const winnerShare = winnerCount / totalVotes;

      // Check conditions
      const botTweetId = botTweetIds.get(note.note_id);
      const hasSuperMajority = winnerShare >= 2 / 3;
      const matchesBot = !botTweetId || botTweetId === winnerTweetId;

      let flag: string | null = null;
      if (!hasSuperMajority) {
        flag = `split:${sorted.map(([id, c]) => `${id.slice(-6)}=${c}`).join("/")}`;
      } else if (!matchesBot) {
        flag = `disagrees_with_notes_table:snapshots=${winnerTweetId},notes=${botTweetId}`;
      }

      // Update if tweet_id changed or flag changed
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
   * Detect anomalies in snapshot data across scrapes.
   *
   * Checks for:
   * 1. View count decreasing between consecutive snapshots (virtualizer corruption)
   * 2. Note text changing between snapshots (virtualizer corruption — note text is immutable on X)
   *
   * Returns list of anomalies found.
   */
  async detectSnapshotAnomalies(): Promise<{
    viewCountDecreases: Array<{ note_id: string; from: number; to: number; fromDate: string; toDate: string }>;
    noteTextChanges: Array<{ note_id: string; texts: string[]; dates: string[] }>;
  }> {
    // Keyset pagination paginates by id so the underlying scraped_at order
    // is lost; we re-sort each per-note group below.
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

    // Group by note_id and sort each group by scraped_at ascending.
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
      // 1. Check for view count decreases
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

      // 2. Check for note text changes (only among snapshots that have note_text)
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

  /**
   * Insert a snapshot from the public CN data dump
   */
  async insertPublicDataSnapshot(snapshot: Omit<PublicDataSnapshot, "id" | "created_at">): Promise<void> {
    // Use upsert to update note_text if it was previously null
    const { error } = await this.client
      .from("public_data_snapshots")
      .upsert(snapshot, {
        onConflict: "note_id,snapshot_date",
        ignoreDuplicates: false,
      });

    if (error) {
      // Re-throw to let caller handle
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
   * Run a head-only exact count with retries, returning 0 (and logging) on error.
   *
   * HEAD responses have no body, so on failure the HTTP status is the only
   * diagnostic. Transient failures (network, 5xx, timeouts) are retried; once
   * retries are exhausted a one-row GET runs the same count, which either
   * recovers it or surfaces the real PostgREST error body.
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

  /** Count notes submitted in the last N hours (rolling window) */
  async countRecentSubmissions(hours: number): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    return this.runExactCount(
      (head) => this.client.from("notes").select("id", { count: "exact", head }).gte("submitted_at", since).limit(1),
      "recent submissions",
    );
  }

  /** Count pipeline_runs created in the last N hours */
  async countRecentPipelineRuns(hours: number): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    return this.runExactCount(
      (head) =>
        this.client.from("pipeline_runs").select("id", { count: "exact", head }).gte("created_at", since).limit(1),
      "recent pipeline runs",
    );
  }

  /** Count pipeline_runs created in the last N hours whose outcome is in `outcomes` */
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
