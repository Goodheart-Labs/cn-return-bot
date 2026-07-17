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
  context_quote: string | null;
  context_paragraph: string | null;
  /** Article images the claim is based on (Substack). Shown above the context. */
  image_urls: string[];
  /** Current live-source wording when it has drifted from the captured quote
   *  (sources heal — sometimes because of the note). Null = still matches. */
  updated_quote: string | null;
  context_url: string | null;
  start_seconds: number | null;
  end_seconds: number | null;
}

/** One cited source of a note (everything_note_sources row, embedded via join).
 *  `quote` is the verbatim passage the verifier extracted; null = URL only. */
export interface NoteSourceRow {
  url: string;
  quote: string | null;
  explanation: string | null;
  sort_order: number;
}

export interface NoteRow {
  id: string;
  claim_id: string;
  note: string;
  sources: NoteSourceRow[]; // citations, joined from everything_note_sources
  helpful_count: number;
  somewhat_helpful_count: number;
  not_helpful_count: number;
  author_id: string | null;   // null = the AI-written note
  author_name: string | null; // display name captured at submit time
  status: "published" | "draft" | "hidden";
  created_at: string;
  claim: ClaimRef | null;
}
