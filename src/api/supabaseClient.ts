import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows as fetchAllRowsShared } from "./paging";

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

  // ============================================
  // Tweets
  // ============================================

  /**
   * Bulk insert tweets from fetched eligibility-endpoint posts. Derives
   * has_video / has_photo / media_count / video_duration_ms from post.media.
   * Insert-only: rows whose tweet_id already exists are skipped, so engagement
   * metrics remain frozen at first sight.
   */
  async bulkInsertNewTweets(posts: Array<{
    id: string;
    author_id?: string;
    text?: string;
    created_at?: string;
    media?: any[];
    referenced_tweets?: any[];
    referenced_tweet_data?: any;
    public_metrics?: {
      impression_count?: number;
      like_count?: number;
      retweet_count?: number;
      reply_count?: number;
      quote_count?: number;
      bookmark_count?: number;
    };
    author_followers?: number;
    author_name?: string;
    author_description?: string;
    author_tweet_count?: number;
  }>): Promise<void> {
    if (!posts.length) return;
    const now = new Date().toISOString();
    const rows = posts.map((post) => {
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
        has_video: !!videoMedia,
        has_photo: post.media?.some((m) => m.type === "photo") ?? false,
        media_count: post.media?.length ?? 0,
        video_duration_ms: videoMedia?.duration_ms,
        last_updated_at: now,
      };
    });
    const { error } = await this.client.from("tweets").upsert(rows, { onConflict: "tweet_id", ignoreDuplicates: true });
    if (error) {
      console.error(`[SupabaseLogger] Error bulk-inserting ${rows.length} tweets:`, error);
      throw error;
    }
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
      .update({
        outcome: data.outcome,
        outcome_reason: data.outcome_reason,
        error_message: data.error_message,
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
      })
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

  /** Count notes submitted in the last N hours (rolling window) */
  async countRecentSubmissions(hours: number): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { count, error } = await this.client
      .from("notes")
      .select("*", { count: "exact", head: true })
      .gte("submitted_at", since);
    if (error) {
      console.warn("[SupabaseLogger] Failed to count recent submissions:", error.message);
      return 0;
    }
    return count ?? 0;
  }

  /** Count pipeline_runs created in the last N hours */
  async countRecentPipelineRuns(hours: number): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { count, error } = await this.client
      .from("pipeline_runs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since);
    if (error) {
      console.warn("[SupabaseLogger] Failed to count recent pipeline runs:", error.message);
      return 0;
    }
    return count ?? 0;
  }

  /** Count pipeline_runs created in the last N hours whose outcome is in `outcomes` */
  async countRecentPipelineRunsByOutcomes(hours: number, outcomes: string[]): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { count, error } = await this.client
      .from("pipeline_runs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since)
      .in("outcome", outcomes);
    if (error) {
      console.warn("[SupabaseLogger] Failed to count recent pipeline runs by outcome:", error.message);
      return 0;
    }
    return count ?? 0;
  }

  /** Check if any notes have been submitted since a given ISO timestamp */
  async hasSubmissionsSince(since: string): Promise<boolean> {
    const { count, error } = await this.client
      .from("notes")
      .select("*", { count: "exact", head: true })
      .gte("submitted_at", since);
    if (error) {
      console.warn("[SupabaseLogger] Failed to check submissions since:", error.message);
      return true; // assume reset on error so we don't get stuck in cautious mode
    }
    return (count ?? 0) > 0;
  }

}
