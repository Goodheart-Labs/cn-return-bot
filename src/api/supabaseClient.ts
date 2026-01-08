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

export type NoteInsert = Omit<Note, "id" | "submitted_at" | "helpful_count" | "somewhat_helpful_count" | "not_helpful_count"> & {
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
}
