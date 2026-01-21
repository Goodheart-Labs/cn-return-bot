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
   * Get tweet IDs that have already been processed (to avoid duplicates)
   */
  async getProcessedTweetIds(): Promise<Set<string>> {
    const tweetIds = new Set<string>();

    try {
      // Get from pipeline_runs (recent processing attempts)
      const { data: pipelineData, error: pipelineError } = await this.client
        .from("pipeline_runs")
        .select("tweet_id");

      if (pipelineError) {
        console.error("[SupabaseLogger] Error fetching pipeline runs:", pipelineError);
      } else if (pipelineData) {
        pipelineData.forEach((row) => {
          if (row.tweet_id) tweetIds.add(row.tweet_id);
        });
      }

      // Also get from notes table (submitted notes)
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

      console.log(`[SupabaseLogger] Found ${tweetIds.size} already-processed tweet IDs`);
      return tweetIds;
    } catch (error) {
      console.error("[SupabaseLogger] Error fetching processed tweet IDs:", error);
      // Return empty set on error to allow processing to continue
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
