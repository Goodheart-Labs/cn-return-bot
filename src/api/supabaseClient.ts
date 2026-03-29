import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Database types
export interface Notewriter {
  id: string;
  handle: string;
  display_name?: string;
  credentials_ref?: string;
  is_active: boolean;
  created_at: string;
}

export interface BotConfig {
  id: string;
  name: string;
  description?: string;
  config?: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export interface Note {
  id: string;
  note_id: string;
  tweet_id: string;
  notewriter_id?: string;
  bot_config_id?: string;
  bot_name?: string;
  note_text: string;
  source_url?: string;
  evaluation_score?: number;
  commit_sha?: string;
  submitted_at: string;
  cn_status?: string;
  helpful_count: number;
  somewhat_helpful_count: number;
  not_helpful_count: number;
  first_helpful_at?: string;
  view_count?: number;
  views_last_updated_at?: string;
  last_checked_at?: string;
}

export interface NoteStatusHistory {
  id: string;
  note_id: string;
  status: string;
  helpful_count?: number;
  somewhat_helpful_count?: number;
  not_helpful_count?: number;
  view_count?: number;
  recorded_at: string;
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

/**
 * Note enriched with latest snapshot data
 * - effective_status: public data status OR fallback to snapshot status
 * - view_count: always from snapshot (only source)
 */
export interface NoteWithSnapshot {
  id: string;
  note_id: string;
  tweet_id: string;
  bot_name?: string;
  note_text: string;
  source_url?: string;
  evaluation_score?: number;
  submitted_at: string;

  // Effective values (computed)
  effective_status: string;
  view_count: number;
  status_source: "public_data" | "snapshot" | "unknown";

  // Raw values
  public_data_status?: string;
  snapshot_status?: string;
  snapshot_views?: number;
  snapshot_scraped_at?: string;

  // Timestamps
  first_helpful_at?: string;

  // Media info (from pipeline_runs)
  has_video?: boolean;

  // Retry info
  is_retry?: boolean;
}

export type NoteInsert = Omit<Note, "id" | "submitted_at" | "helpful_count" | "somewhat_helpful_count" | "not_helpful_count"> & {
  submitted_at?: string;
  view_count?: number;
  views_last_updated_at?: string;
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
   * Fetch all rows from a query, paginating past Supabase's 1000-row default limit.
   */
  async fetchAllRows<T>(
    buildQuery: (from: SupabaseClient) => any
  ): Promise<T[]> {
    const PAGE_SIZE = 1000;
    const allRows: T[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await (buildQuery(this.client) as any).range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return allRows;
  }

  /**
   * Insert a new note record after successful submission
   */
  async logNoteSubmission(note: NoteInsert): Promise<Note | null> {
    const { data, error } = await this.client
      .from("notes")
      .insert(note)
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

  /**
   * Get or create a bot config by name
   */
  async getOrCreateBotConfig(name: string, description?: string): Promise<BotConfig> {
    // Try to find existing
    const { data: existing } = await this.client
      .from("bot_configs")
      .select()
      .eq("name", name)
      .single();

    if (existing) {
      return existing;
    }

    // Create new
    const { data, error } = await this.client
      .from("bot_configs")
      .insert({ name, description })
      .select()
      .single();

    if (error) {
      console.error("[SupabaseLogger] Error creating bot config:", error);
      throw error;
    }

    return data;
  }

  /**
   * Update note with feedback from CN public data
   */
  async updateNoteFeedback(
    noteId: string,
    feedback: {
      cn_status?: string;
      helpful_count?: number;
      somewhat_helpful_count?: number;
      not_helpful_count?: number;
      first_helpful_at?: string;
    }
  ): Promise<void> {
    const { error } = await this.client
      .from("notes")
      .update({
        ...feedback,
        last_checked_at: new Date().toISOString(),
      })
      .eq("note_id", noteId);

    if (error) {
      console.error("[SupabaseLogger] Error updating note feedback:", error);
      throw error;
    }
  }

  /**
   * Get notes that need feedback updates (no status or stale)
   */
  async getNotesNeedingFeedback(staleDays: number = 1): Promise<Note[]> {
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - staleDays);

    return this.fetchAllRows<Note>(
      (client) => client.from("notes").select()
        .or(`last_checked_at.is.null,last_checked_at.lt.${staleDate.toISOString()}`)
    );
  }

  /**
   * Update view count for a note
   */
  async updateViewCount(noteId: string, viewCount: number): Promise<void> {
    const { error } = await this.client
      .from("notes")
      .update({
        view_count: viewCount,
        views_last_updated_at: new Date().toISOString(),
      })
      .eq("note_id", noteId);

    if (error) {
      console.error("[SupabaseLogger] Error updating view count:", error);
      throw error;
    }
  }

  /**
   * Get note by note_id
   */
  async getNoteByNoteId(noteId: string): Promise<Note | null> {
    const { data, error } = await this.client
      .from("notes")
      .select()
      .eq("note_id", noteId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        // Not found
        return null;
      }
      console.error("[SupabaseLogger] Error fetching note:", error);
      throw error;
    }

    return data;
  }

  /**
   * Update an existing note with manual scraped data
   * Throws error if note doesn't exist - use logUnmatchedScrapedNote() for unmatched notes
   */
  async updateScrapedNote(data: {
    note_id: string;
    cn_status?: string;
    view_count?: number;
  }): Promise<Note> {
    // Check if note exists
    const existing = await this.getNoteByNoteId(data.note_id);

    if (!existing) {
      throw new Error(
        `Note ${data.note_id} not found in database. Use logUnmatchedScrapedNote() to record unmatched notes.`
      );
    }

    // Update existing note
    const updateData: any = {
      last_checked_at: new Date().toISOString(),
    };

    if (data.cn_status) updateData.cn_status = data.cn_status;
    if (data.view_count !== undefined) {
      updateData.view_count = data.view_count;
      updateData.views_last_updated_at = new Date().toISOString();
    }

    const { data: updated, error } = await this.client
      .from("notes")
      .update(updateData)
      .eq("note_id", data.note_id)
      .select()
      .single();

    if (error) {
      console.error("[SupabaseLogger] Error updating scraped note:", error);
      throw error;
    }

    console.log(`[SupabaseLogger] Updated note ${data.note_id} with scraped data`);
    return updated;
  }

  /**
   * Upsert an unmatched scraped note (note found on X but not in our database)
   * These are notes created before tracking started
   * If the note exists in unmatched table, updates view count and status. If not, creates it.
   */
  async upsertUnmatchedScrapedNote(data: {
    note_id: string;
    tweet_id: string;
    note_text: string;
    cn_status?: string;
    view_count?: number;
    source_url?: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const upsertData: any = {
      note_id: data.note_id,
      tweet_id: data.tweet_id,
      note_text: data.note_text,
      cn_status: data.cn_status,
      source_url: data.source_url,
      last_checked_at: now,
    };

    // Add view count fields if provided
    if (data.view_count !== undefined) {
      upsertData.view_count = data.view_count;
      upsertData.views_last_updated_at = now;
    }

    const { error } = await this.client
      .from("unmatched_scraped_notes")
      .upsert(upsertData, {
        onConflict: "note_id",
      });

    if (error) {
      console.error("[SupabaseLogger] Error upserting unmatched note:", error);
      throw error;
    }

    console.log(`[SupabaseLogger] Upserted unmatched note ${data.note_id}`);
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
      .from("canonical_note_information")
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
    helpful_count?: number;
    somewhat_helpful_count?: number;
    not_helpful_count?: number;
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
        helpful_count: data.helpful_count,
        somewhat_helpful_count: data.somewhat_helpful_count,
        not_helpful_count: data.not_helpful_count,
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
      .from("canonical_note_information")
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
      .from("canonical_note_information")
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
    // Update snapshots first (they have foreign key to notes)
    const { error: snapshotError } = await this.client
      .from("scraped_notewriter_snapshots")
      .update({ note_id: newNoteId })
      .eq("note_id", oldNoteId);

    if (snapshotError) {
      console.error("[SupabaseLogger] Error updating snapshot note_ids:", snapshotError);
      throw snapshotError;
    }

    // Update the note itself
    const { error: noteError } = await this.client
      .from("canonical_note_information")
      .update({ note_id: newNoteId })
      .eq("note_id", oldNoteId);

    if (noteError) {
      console.error("[SupabaseLogger] Error updating note_id:", noteError);
      throw noteError;
    }
  }

  /**
   * Get pipeline run outcomes grouped by bot
   */
  async getPipelineRunsByBot(): Promise<Record<string, { total: number; submitted: number; filtered: number; failed: number; rejected: number; created_at_min?: string; created_at_max?: string }>> {
    const data = await this.fetchAllRows<{ bot_id: string; outcome: string; created_at: string }>(
      (client) => client.from("pipeline_runs").select("bot_id, outcome, created_at")
    );

    const result: Record<string, { total: number; submitted: number; filtered: number; failed: number; rejected: number; created_at_min?: string; created_at_max?: string }> = {};

    for (const row of data) {
      const bot = row.bot_id || "unknown";
      if (!result[bot]) {
        result[bot] = { total: 0, submitted: 0, filtered: 0, failed: 0, rejected: 0 };
      }
      result[bot].total++;
      const outcome = row.outcome as "submitted" | "filtered" | "failed" | "rejected";
      if (outcome in result[bot]) {
        result[bot][outcome]++;
      }
      // Track date range
      if (!result[bot].created_at_min || row.created_at < result[bot].created_at_min!) {
        result[bot].created_at_min = row.created_at;
      }
      if (!result[bot].created_at_max || row.created_at > result[bot].created_at_max!) {
        result[bot].created_at_max = row.created_at;
      }
    }

    return result;
  }

  /**
   * Get raw pipeline runs with timestamps for client-side filtering
   */
  async getPipelineRunsRaw(): Promise<Array<{ bot_id: string; outcome: string; created_at: string }>> {
    try {
      const data = await this.fetchAllRows<{ bot_id: string; outcome: string; created_at: string }>(
        (client) => client.from("pipeline_runs").select("bot_id, outcome, created_at")
      );
      return data.map(r => ({
        bot_id: r.bot_id || "unknown",
        outcome: r.outcome,
        created_at: r.created_at,
      }));
    } catch (error) {
      console.error("[SupabaseLogger] Error fetching raw pipeline runs:", error);
      return [];
    }
  }

  /**
   * Get scraped note IDs in a given range (for coverage checks)
   */
  async getScrapedNoteIdsInRange(minId: string, maxId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from("canonical_note_information")
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
  // Notes with Snapshot Data
  // ============================================

  /**
   * Get all notes enriched with their latest snapshot data.
   *
   * Logic:
   * - status: prefer notes.cn_status (public data), fallback to latest snapshot
   * - views: always from latest snapshot (only source)
   */
  async getNotesWithLatestSnapshots(): Promise<NoteWithSnapshot[]> {
    // Get all notes (paginated to avoid 1000-row default limit)
    const notes = await this.fetchAllRows<any>(
      (client) => client.from("notes").select("*")
    );

    if (notes.length === 0) {
      return [];
    }

    // Get reconciled canonical data (tier-classified, collision-resolved)
    // Only use non-junk tiers for enrichment
    const reconciledNotes = await this.fetchAllRows<{
      note_id: string;
      cn_status: string | null;
      view_count: number | null;
      data_tier: string | null;
      last_reconciled_at: string | null;
    }>(
      (client) => client.from("canonical_note_information")
        .select("note_id, cn_status, view_count, data_tier, last_reconciled_at")
        .neq("data_tier", "junk")
    );

    // Get video info from pipeline_runs
    let pipelineRuns: Array<{ tweet_id: string; has_video: boolean }> = [];
    try {
      pipelineRuns = await this.fetchAllRows<{ tweet_id: string; has_video: boolean }>(
        (client) => client.from("pipeline_runs").select("tweet_id, has_video").eq("outcome", "submitted")
      );
    } catch (pipelineError) {
      console.error("[SupabaseLogger] Error fetching pipeline runs:", pipelineError);
      // Don't throw - video info is optional
    }

    // Get submitted/failed pipeline_runs to determine retry status (count actual attempts per tweet_id)
    // Excludes filtered/rejected runs since those aren't real submission attempts
    let allRuns: Array<{ tweet_id: string }> = [];
    try {
      allRuns = await this.fetchAllRows<{ tweet_id: string }>(
        (client) => client.from("pipeline_runs").select("tweet_id").in("outcome", ["submitted", "failed"])
      );
    } catch (allRunsError) {
      console.error("[SupabaseLogger] Error fetching all pipeline runs:", allRunsError);
    }

    // Build tweet_id -> has_video map
    const videoInfo: Record<string, boolean> = {};
    for (const run of pipelineRuns || []) {
      if (run.tweet_id && run.has_video !== null) {
        videoInfo[run.tweet_id] = run.has_video;
      }
    }

    // Build tweet_id -> run count map (>1 means retry)
    const runCounts: Record<string, number> = {};
    for (const run of allRuns || []) {
      if (run.tweet_id) {
        runCounts[run.tweet_id] = (runCounts[run.tweet_id] || 0) + 1;
      }
    }

    // Build reconciled data lookup per note_id
    const reconciledByNote: Record<
      string,
      { cn_status?: string; view_count?: number; reconciled_at?: string }
    > = {};
    for (const rec of reconciledNotes || []) {
      reconciledByNote[rec.note_id] = {
        cn_status: rec.cn_status ?? undefined,
        view_count: rec.view_count ?? undefined,
        reconciled_at: rec.last_reconciled_at ?? undefined,
      };
    }

    // Enrich notes with reconciled snapshot data
    return notes.map((note) => {
      const rec = reconciledByNote[note.note_id];

      // Status: prefer public data, fallback to reconciled snapshot (junk excluded)
      const publicDataStatus = note.cn_status;
      const snapshotStatus = rec?.cn_status;
      const effectiveStatus = publicDataStatus || snapshotStatus || "unknown";

      // Determine source
      let statusSource: "public_data" | "snapshot" | "unknown" = "unknown";
      if (publicDataStatus) {
        statusSource = "public_data";
      } else if (snapshotStatus) {
        statusSource = "snapshot";
      }

      return {
        id: note.id,
        note_id: note.note_id,
        tweet_id: note.tweet_id,
        bot_name: note.bot_name,
        note_text: note.note_text,
        source_url: note.source_url,
        evaluation_score: note.evaluation_score,
        submitted_at: note.submitted_at,

        // Computed values
        effective_status: effectiveStatus,
        view_count: rec?.view_count || 0,
        status_source: statusSource,

        // Raw values
        public_data_status: publicDataStatus,
        snapshot_status: snapshotStatus,
        snapshot_views: rec?.view_count,
        snapshot_scraped_at: rec?.reconciled_at,

        // Timestamps
        first_helpful_at: note.first_helpful_at,

        // Media info
        has_video: videoInfo[note.tweet_id],

        // Retry info
        is_retry: (runCounts[note.tweet_id] || 1) > 1,
      };
    });
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
    author_id?: string;
    tweet_text?: string;
    has_video?: boolean;
    has_photo?: boolean;
    media_count?: number;
    video_duration_ms?: number;
    bot_id?: string;
    commit_sha?: string;
    tweet_impressions?: number;
    tweet_likes?: number;
    tweet_retweets?: number;
    tweet_replies?: number;
    tweet_quotes?: number;
    tweet_bookmarks?: number;
    author_followers?: number;
  }): Promise<string> {
    const { data: result, error } = await this.client
      .from("pipeline_runs")
      .insert({
        tweet_id: data.tweet_id,
        author_id: data.author_id,
        tweet_text: data.tweet_text,
        has_video: data.has_video ?? false,
        has_photo: data.has_photo ?? false,
        media_count: data.media_count ?? 0,
        video_duration_ms: data.video_duration_ms,
        bot_id: data.bot_id,
        commit_sha: data.commit_sha,
        tweet_impressions: data.tweet_impressions,
        tweet_likes: data.tweet_likes,
        tweet_retweets: data.tweet_retweets,
        tweet_replies: data.tweet_replies,
        tweet_quotes: data.tweet_quotes,
        tweet_bookmarks: data.tweet_bookmarks,
        author_followers: data.author_followers,
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
      bot_id?: string;
      note_text?: string;
      source_url?: string;
      note_status?: string;
      search_results?: string;
      check_reasoning?: string;
      logs?: Record<string, unknown>;
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
        bot_id: data.bot_id,
        note_text: data.note_text,
        source_url: data.source_url,
        note_status: data.note_status,
        search_results: data.search_results,
        check_reasoning: data.check_reasoning,
        logs: data.logs,
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
   * Fetch all unsubmitted candidates with their scores for ranking.
   */
  async fetchCandidates(): Promise<
    {
      id: string;
      tweet_id: string;
      note_text: string;
      source_url: string;
      bot_id: string;
      created_at: string;
      search_results: string;
      tweet_text: string;
      scores: { score_type: string; score_value: number | null }[];
    }[]
  > {
    const runs = await this.fetchAllRows<{
      id: string;
      tweet_id: string;
      note_text: string;
      source_url: string;
      bot_id: string;
      created_at: string;
      search_results: string;
      tweet_text: string;
      pipeline_scores: { score_type: string; score_value: number | null }[];
    }>(
      (client) =>
        client
          .from("pipeline_runs")
          .select("id, tweet_id, note_text, source_url, bot_id, created_at, search_results, tweet_text, pipeline_scores(score_type, score_value)")
          .eq("outcome", "candidate")
          .order("created_at", { ascending: false })
    );

    return runs.map((r) => ({
      id: r.id,
      tweet_id: r.tweet_id,
      note_text: r.note_text,
      source_url: r.source_url,
      bot_id: r.bot_id,
      created_at: r.created_at,
      search_results: r.search_results,
      tweet_text: r.tweet_text,
      scores: r.pipeline_scores,
    }));
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
   * Mark a candidate as expired (too old or failed permanently).
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
   * Get pipeline outcomes grouped by bot for reporting
   */
  async getPipelineOutcomesByBot(): Promise<{
    bot_id: string;
    note_not_needed: number;
    failed_to_write: number;
  }[]> {
    const data = await this.fetchAllRows<{ bot_id: string; outcome: string; outcome_reason: string }>(
      (client) => client.from("pipeline_runs")
        .select("bot_id, outcome, outcome_reason")
        .in("outcome", ["rejected", "failed"])
    );

    // Group by bot_id
    const byBot: Record<string, { note_not_needed: number; failed_to_write: number }> = {};

    for (const row of data) {
      const botId = row.bot_id || "unknown";
      if (!byBot[botId]) {
        byBot[botId] = { note_not_needed: 0, failed_to_write: 0 };
      }

      // "Note Not Needed" = rejected with outcome_reason = "no_correction_needed"
      if (row.outcome === "rejected" && row.outcome_reason === "no_correction_needed") {
        byBot[botId].note_not_needed++;
      } else {
        // Everything else (failed or other rejected reasons) = "Failed to Write"
        byBot[botId].failed_to_write++;
      }
    }

    return Object.entries(byBot).map(([bot_id, counts]) => ({
      bot_id,
      ...counts,
    }));
  }

  /**
   * Convenience method: log a filtered post (didn't enter main pipeline)
   */
  async logFilteredPost(data: {
    tweet_id: string;
    author_id?: string;
    tweet_text?: string;
    has_video?: boolean;
    has_photo?: boolean;
    media_count?: number;
    video_duration_ms?: number;
    filter_reason: string;
    commit_sha?: string;
  }): Promise<void> {
    const { error } = await this.client.from("pipeline_runs").insert({
      tweet_id: data.tweet_id,
      author_id: data.author_id,
      tweet_text: data.tweet_text,
      has_video: data.has_video ?? false,
      has_photo: data.has_photo ?? false,
      media_count: data.media_count ?? 0,
      video_duration_ms: data.video_duration_ms,
      commit_sha: data.commit_sha,
      outcome: "filtered",
      outcome_reason: data.filter_reason,
      final_stage: "filtering",
    });

    if (error) {
      console.error("[SupabaseLogger] Error logging filtered post:", error);
      throw error;
    }
  }

  /**
   * Get tweet IDs that should be permanently skipped:
   * - Tweets that were submitted (have a note)
   * - Tweets with "no_correction_needed" rejections on cooldown:
   *   1 rejection + <1hr ago → skip (retry after 1 hour)
   *   2 rejections + <24hr ago → skip (retry after 24 hours)
   *   3+ rejections → permanent skip
   */
  async getProcessedTweetIds(): Promise<Set<string>> {
    const tweetIds = new Set<string>();

    try {
      // Get submitted notes - always skip these (paginated to avoid 1000-row limit)
      const notesData = await this.fetchAllRows<{ tweet_id: string }>(
        (client) => client.from("notes").select("tweet_id")
      );
      notesData.forEach((row) => {
        if (row.tweet_id) tweetIds.add(row.tweet_id);
      });

      // Get no_correction_needed rejections with timestamps for cooldown logic
      try {
        const pipelineData = await this.fetchAllRows<{ tweet_id: string; created_at: string }>(
          (client) => client.from("pipeline_runs").select("tweet_id, created_at")
            .eq("outcome", "rejected")
            .eq("outcome_reason", "no_correction_needed")
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
            // 3+ rejections: permanent skip
            tweetIds.add(tweetId);
          } else {
            const hoursSinceLatest = (now.getTime() - info.latestAt.getTime()) / (1000 * 60 * 60);
            const cooldownHours = info.count === 1 ? 1 : 24;
            if (hoursSinceLatest < cooldownHours) {
              tweetIds.add(tweetId);
            }
            // Otherwise cooldown elapsed — tweet is eligible for retry
          }
        }
      } catch (pipelineError) {
        console.error("[SupabaseLogger] Error fetching pipeline runs:", pipelineError);
      }

      // Skip tweets that have an above-floor candidate waiting for submission.
      // Below-floor candidates (eval < 0) are left eligible for re-roll by a different bot.
      try {
        const candidateData = await this.fetchAllRows<{
          id: string;
          tweet_id: string;
          pipeline_scores: { score_type: string; score_value: number | null }[];
        }>(
          (client) => client.from("pipeline_runs")
            .select("id, tweet_id, pipeline_scores(score_type, score_value)")
            .eq("outcome", "candidate")
        );

        for (const row of candidateData) {
          const evalScore = row.pipeline_scores.find(
            (s) => s.score_type === "evaluation" && s.score_value !== null
          )?.score_value ?? undefined;
          if (evalScore !== undefined && evalScore >= 0) {
            tweetIds.add(row.tweet_id);
          }
        }
      } catch (candidateError) {
        console.error("[SupabaseLogger] Error fetching candidate tweet IDs:", candidateError);
      }

      return tweetIds;
    } catch (error) {
      console.error("[SupabaseLogger] Error fetching processed tweet IDs:", error);
      return new Set();
    }
  }

  /**
   * Get all tweet IDs that have ever been processed (pipeline_runs + notes).
   * Used to distinguish new tweets from retries.
   */
  async getAllProcessedTweetIds(): Promise<Set<string>> {
    const tweetIds = new Set<string>();
    try {
      const pipelineRows = await this.fetchAllRows<{ tweet_id: string }>(
        (client) => client.from("pipeline_runs").select("tweet_id")
      );
      pipelineRows.forEach((row) => {
        if (row.tweet_id) tweetIds.add(row.tweet_id);
      });

      const notesRows = await this.fetchAllRows<{ tweet_id: string }>(
        (client) => client.from("notes").select("tweet_id")
      );
      notesRows.forEach((row) => {
        if (row.tweet_id) tweetIds.add(row.tweet_id);
      });

      return tweetIds;
    } catch (error) {
      console.error("[SupabaseLogger] Error fetching all processed tweet IDs:", error);
      return new Set();
    }
  }

  /**
   * Get pipeline statistics
   */
  async getPipelineStats(since?: Date): Promise<{
    total: number;
    by_outcome: Record<string, number>;
    by_stage: Record<string, number>;
    video_count: number;
  }> {
    const sinceIso = since?.toISOString();
    const data = await this.fetchAllRows<{ outcome: string; final_stage: string; has_video: boolean }>(
      (client) => {
        let q = client.from("pipeline_runs").select("outcome, final_stage, has_video");
        if (sinceIso) q = q.gte("created_at", sinceIso);
        return q;
      }
    );

    const by_outcome: Record<string, number> = {};
    const by_stage: Record<string, number> = {};
    let video_count = 0;

    for (const row of data) {
      by_outcome[row.outcome] = (by_outcome[row.outcome] || 0) + 1;
      by_stage[row.final_stage] = (by_stage[row.final_stage] || 0) + 1;
      if (row.has_video) video_count++;
    }

    return {
      total: data.length,
      by_outcome,
      by_stage,
      video_count,
    };
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
      (client) => client.from("canonical_note_information")
        .select("note_id, view_count, cn_status, data_tier")
        .neq("data_tier", "junk")
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
   * For each note_id in canonical_note_information:
   * - Collect all non-null tweet_ids from its snapshots
   * - If the top tweet_id has >= 2/3 of votes AND matches the `notes` table (if entry exists), clear the flag
   * - Otherwise, set tweet_id_flag with the reason
   * - Update canonical_note_information.tweet_id to the majority winner (if there is one)
   *
   * Returns summary stats.
   */
  async deriveTweetIds(): Promise<{ total: number; updated: number; flagged: number; noVotes: number }> {
    // 1. Get all snapshots with tweet_id
    const snapshots = await this.fetchAllRows<{ note_id: string; tweet_id: string | null }>(
      (client) => client.from("scraped_notewriter_snapshots")
        .select("note_id, tweet_id")
    );

    // 2. Get all scraped notes
    const scrapedNotes = await this.fetchAllRows<{ note_id: string; tweet_id: string }>(
      (client) => client.from("canonical_note_information")
        .select("note_id, tweet_id")
    );

    // 3. Get bot-submitted notes (source of truth for tweet_id)
    const botNotes = await this.fetchAllRows<{ note_id: string; tweet_id: string }>(
      (client) => client.from("notes")
        .select("note_id, tweet_id")
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
          .from("canonical_note_information")
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
    // Fetch all snapshots with relevant fields, ordered by scraped_at
    const snapshots = await this.fetchAllRows<{
      note_id: string;
      view_count: number | null;
      note_text: string | null;
      cn_status: string | null;
      scraped_at: string;
    }>(
      (client) => client.from("scraped_notewriter_snapshots")
        .select("note_id, view_count, note_text, cn_status, scraped_at")
        .order("scraped_at", { ascending: true })
    );

    // Group by note_id
    const byNote = new Map<string, typeof snapshots>();
    for (const snap of snapshots) {
      if (!byNote.has(snap.note_id)) byNote.set(snap.note_id, []);
      byNote.get(snap.note_id)!.push(snap);
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

  async logRunSnapshot(data: {
    backlog_total: number;
    backlog_new: number;
    backlog_retry: number;
    backlog_hit_limit: boolean;
    posts_processed: number;
    commit_sha?: string;
    feed_size?: string;
  }): Promise<void> {
    const { error } = await this.client
      .from("run_snapshots")
      .insert(data);
    if (error) {
      console.warn("[SupabaseLogger] Failed to log run snapshot:", error.message);
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
}
