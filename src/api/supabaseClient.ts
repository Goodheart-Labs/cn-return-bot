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

  /**
   * Upsert a note to the scraped_notewriter_notes table
   * Creates if not exists, does nothing if exists (immutable core data)
   */
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
          ignoreDuplicates: true, // Don't update if exists
        }
      );

    if (error) {
      console.error("[SupabaseLogger] Error upserting scraped notewriter note:", error);
      throw error;
    }
  }

  /**
   * Insert a snapshot for a scraped note (always creates new row for time-series tracking)
   */
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

  /**
   * Check if a scraped notewriter note exists
   */
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
}
