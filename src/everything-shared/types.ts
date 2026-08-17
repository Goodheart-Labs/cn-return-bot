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

/** The claim a note fact-checks. PostgREST embeds it on the note row. */
export interface ClaimRef {
  id: string;
  item_id: string;
  claim: string;
  context_quote: string | null;
  context_paragraph: string | null;
  /** The article images the claim rests on. Only Substack items have them. They
   *  are shown above the context. */
  image_urls: string[];
  /** The wording the live source carries now, when it has drifted away from the
   *  quote we captured. Sources do get corrected, sometimes because of the note
   *  itself. Null means the source still matches the captured quote. */
  updated_quote: string | null;
  context_url: string | null;
  start_seconds: number | null;
  end_seconds: number | null;
}

/** One source a note cites. It is a row of everything_note_sources, embedded via
 *  a join. `quote` is the passage the verifier copied out of that source word for
 *  word. Null there means we have the URL and nothing else. */
export interface NoteSourceRow {
  url: string;
  quote: string | null;
  explanation: string | null;
  sort_order: number;
}

/** An argument that the claim needs no note at all. It is keyed to the claim
 *  rather than to a note, so the same list renders under every note written on
 *  that exact text. The entries form a flat list and never nest. */
export interface NnnRow {
  id: string;
  claim_id: string;
  author_id: string | null;
  author_name: string | null; // The byline the author opted into, captured at submit time.
  body: string;
  helpful_count: number;
  somewhat_helpful_count: number;
  not_helpful_count: number;
  status: "published" | "hidden";
  created_at: string;
}

export interface NoteRow {
  id: string;
  claim_id: string;
  note: string;
  sources: NoteSourceRow[]; // The note's citations, joined from everything_note_sources.
  helpful_count: number;
  somewhat_helpful_count: number;
  not_helpful_count: number;
  author_id: string | null;   // Null on the note the AI wrote.
  author_name: string | null; // The display name captured at submit time.
  /** The note this one improves. It is set on a note posted through "Suggest an
   *  improvement". The UI renders it as a jump-link between the two cards. */
  improved_from_note_id: string | null;
  status: "published" | "draft" | "hidden";
  created_at: string;
  claim: ClaimRef | null;
}
