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
   * Log status history for tracking changes over time
   */
  async logStatusHistory(
    noteId: string,
    status: string,
    counts?: {
      helpful_count?: number;
      somewhat_helpful_count?: number;
      not_helpful_count?: number;
      view_count?: number;
    }
  ): Promise<void> {
    const { error } = await this.client.from("note_status_history").insert({
      note_id: noteId,
      status,
      ...counts,
    });

    if (error) {
      console.error("[SupabaseLogger] Error logging status history:", error);
      throw error;
    }
  }

  /**
   * Get notes that need feedback updates (no status or stale)
   */
  async getNotesNeedingFeedback(staleDays: number = 1): Promise<Note[]> {
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - staleDays);

    const { data, error } = await this.client
      .from("notes")
      .select()
      .or(`last_checked_at.is.null,last_checked_at.lt.${staleDate.toISOString()}`);

    if (error) {
      console.error("[SupabaseLogger] Error fetching notes needing feedback:", error);
      throw error;
    }

    return data || [];
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
      .from("scraped_notewriter_notes")
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
    cn_status?: string;
    view_count?: number;
    helpful_count?: number;
    somewhat_helpful_count?: number;
    not_helpful_count?: number;
  }): Promise<void> {
    const { error } = await this.client
      .from("scraped_notewriter_snapshots")
      .insert({
        note_id: data.note_id,
        cn_status: data.cn_status,
        view_count: data.view_count,
        helpful_count: data.helpful_count,
        somewhat_helpful_count: data.somewhat_helpful_count,
        not_helpful_count: data.not_helpful_count,
      });

    if (error) {
      console.error("[SupabaseLogger] Error inserting scraped notewriter snapshot:", error);
      throw error;
    }
  }

  async scrapedNotewriterNoteExists(noteId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("scraped_notewriter_notes")
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
      .from("scraped_notewriter_notes")
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
      .from("scraped_notewriter_notes")
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
    const { data, error } = await this.client
      .from("pipeline_runs")
      .select("bot_id, outcome, created_at");

    if (error) {
      console.error("[SupabaseLogger] Error fetching pipeline runs by bot:", error);
      return {};
    }

    const result: Record<string, { total: number; submitted: number; filtered: number; failed: number; rejected: number; created_at_min?: string; created_at_max?: string }> = {};

    for (const row of data || []) {
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
    const { data, error } = await this.client
      .from("pipeline_runs")
      .select("bot_id, outcome, created_at");

    if (error) {
      console.error("[SupabaseLogger] Error fetching raw pipeline runs:", error);
      return [];
    }

    return (data || []).map(r => ({
      bot_id: r.bot_id || "unknown",
      outcome: r.outcome,
      created_at: r.created_at,
    }));
  }

  /**
   * Get scraped note IDs in a given range (for coverage checks)
   */
  async getScrapedNoteIdsInRange(minId: string, maxId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from("scraped_notewriter_notes")
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
    // Get all notes
    const { data: notes, error: notesError } = await this.client
      .from("notes")
      .select("*");

    if (notesError) {
      console.error("[SupabaseLogger] Error fetching notes:", notesError);
      throw notesError;
    }

    if (!notes || notes.length === 0) {
      return [];
    }

    // Get all snapshots ordered by scraped_at DESC
    const { data: snapshots, error: snapshotError } = await this.client
      .from("scraped_notewriter_snapshots")
      .select("note_id, cn_status, view_count, scraped_at")
      .order("scraped_at", { ascending: false });

    if (snapshotError) {
      console.error("[SupabaseLogger] Error fetching snapshots:", snapshotError);
      throw snapshotError;
    }

    // Get video info from submitted pipeline_runs
    const { data: pipelineRuns, error: pipelineError } = await this.client
      .from("pipeline_runs")
      .select("tweet_id, has_video")
      .eq("outcome", "submitted");

    if (pipelineError) {
      console.error("[SupabaseLogger] Error fetching pipeline runs:", pipelineError);
      // Don't throw - video info is optional
    }

    // Get submitted/failed pipeline_runs to determine retry status (count actual attempts per tweet_id)
    // Excludes filtered/rejected runs since those aren't real submission attempts
    const { data: allRuns, error: allRunsError } = await this.client
      .from("pipeline_runs")
      .select("tweet_id")
      .in("outcome", ["submitted", "failed"]);

    if (allRunsError) {
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

    // Build latest snapshot per note_id
    const latestSnapshot: Record<
      string,
      { cn_status?: string; view_count?: number; scraped_at: string }
    > = {};
    for (const snap of snapshots || []) {
      if (!latestSnapshot[snap.note_id]) {
        latestSnapshot[snap.note_id] = {
          cn_status: snap.cn_status,
          view_count: snap.view_count,
          scraped_at: snap.scraped_at,
        };
      }
    }

    // Enrich notes with snapshot data
    return notes.map((note) => {
      const snap = latestSnapshot[note.note_id];

      // Status: prefer public data, fallback to snapshot
      const publicDataStatus = note.cn_status;
      const snapshotStatus = snap?.cn_status;
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
        view_count: snap?.view_count || 0,
        status_source: statusSource,

        // Raw values
        public_data_status: publicDataStatus,
        snapshot_status: snapshotStatus,
        snapshot_views: snap?.view_count,
        snapshot_scraped_at: snap?.scraped_at,

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
      outcome: "submitted" | "filtered" | "failed" | "rejected";
      outcome_reason?: string;
      error_message?: string;
      final_stage: string;
      note_id?: string;
      bot_id?: string;
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
   * Get pipeline outcomes grouped by bot for reporting
   */
  async getPipelineOutcomesByBot(): Promise<{
    bot_id: string;
    note_not_needed: number;
    failed_to_write: number;
  }[]> {
    const { data, error } = await this.client
      .from("pipeline_runs")
      .select("bot_id, outcome, outcome_reason")
      .in("outcome", ["rejected", "failed"]);

    if (error) {
      console.error("[SupabaseLogger] Error fetching pipeline outcomes:", error);
      throw error;
    }

    // Group by bot_id
    const byBot: Record<string, { note_not_needed: number; failed_to_write: number }> = {};

    for (const row of data || []) {
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
   * - Tweets with 2+ "no_correction_needed" rejections
   */
  async getProcessedTweetIds(): Promise<Set<string>> {
    const tweetIds = new Set<string>();

    try {
      // Get submitted notes - always skip these
      const { data: notesData, error: notesError } = await this.client
        .from("notes")
        .select("tweet_id");

      if (notesError) {
        console.error("[SupabaseLogger] Error fetching notes:", notesError);
      } else if (notesData) {
        notesData.forEach((row) => {
          if (row.tweet_id) tweetIds.add(row.tweet_id);
        });
      }

      // Get tweets with 2+ "no_correction_needed" rejections
      const { data: pipelineData, error: pipelineError } = await this.client
        .from("pipeline_runs")
        .select("tweet_id")
        .eq("outcome", "rejected")
        .eq("outcome_reason", "no_correction_needed");

      if (pipelineError) {
        console.error("[SupabaseLogger] Error fetching pipeline runs:", pipelineError);
      } else if (pipelineData) {
        const rejectionCounts = new Map<string, number>();
        pipelineData.forEach((row) => {
          if (row.tweet_id) {
            rejectionCounts.set(row.tweet_id, (rejectionCounts.get(row.tweet_id) || 0) + 1);
          }
        });
        for (const [tweetId, count] of rejectionCounts) {
          if (count >= 2) {
            tweetIds.add(tweetId);
          }
        }
      }

      console.log(`[SupabaseLogger] Found ${tweetIds.size} permanently-skipped tweet IDs`);
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
      const { data, error } = await this.client
        .from("pipeline_runs")
        .select("tweet_id");

      if (!error && data) {
        data.forEach((row) => {
          if (row.tweet_id) tweetIds.add(row.tweet_id);
        });
      }

      const { data: notesData, error: notesError } = await this.client
        .from("notes")
        .select("tweet_id");

      if (!notesError && notesData) {
        notesData.forEach((row) => {
          if (row.tweet_id) tweetIds.add(row.tweet_id);
        });
      }

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
    let query = this.client
      .from("pipeline_runs")
      .select("outcome, final_stage, has_video");

    if (since) {
      query = query.gte("created_at", since.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      console.error("[SupabaseLogger] Error fetching pipeline stats:", error);
      throw error;
    }

    const by_outcome: Record<string, number> = {};
    const by_stage: Record<string, number> = {};
    let video_count = 0;

    for (const row of data || []) {
      by_outcome[row.outcome] = (by_outcome[row.outcome] || 0) + 1;
      by_stage[row.final_stage] = (by_stage[row.final_stage] || 0) + 1;
      if (row.has_video) video_count++;
    }

    return {
      total: data?.length || 0,
      by_outcome,
      by_stage,
      video_count,
    };
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
}
