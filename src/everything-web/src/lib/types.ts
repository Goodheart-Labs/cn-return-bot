export interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
}

export interface ItemRow {
  id: string;
  project_id: string | null;
  source: "youtube" | "substack" | "podcast";
  url: string;
  title: string | null;
  published_at: string | null;
  status: "queued" | "processing" | "done" | "error";
  error: string | null;
  created_at: string;
}

/** The claim a note fact-checks, embedded on the note (PostgREST join). */
export interface ClaimRef {
  id: string;
  item_id: string;
  claim: string;
  context_quote: string;
  context_paragraph: string | null;
  context_url: string | null;
  start_seconds: number | null;
  end_seconds: number | null;
}

export interface NoteRow {
  id: string;
  claim_id: string;
  note: string;
  sources: string[]; // citation URLs, stored in a separate column (not inline in the note text)
  helpful_count: number;
  somewhat_helpful_count: number;
  not_helpful_count: number;
  author_id: string | null;   // null = the AI-written note
  author_name: string | null; // display name captured at submit time
  status: "published" | "draft" | "hidden";
  created_at: string;
  claim: ClaimRef | null;
}

export interface SuggestionRow {
  id: string;
  note_id: string;
  suggested_text: string;
  status: "pending" | "accepted" | "rejected";
  judge_reason: string | null;
  created_at: string;
}
