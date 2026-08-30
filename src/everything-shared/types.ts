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
  /** What the pipeline was asked to read (migration 081). `page` is the whole
   *  article or transcript, `paragraph` only a highlighted passage. Null means
   *  no run was ever intended: a reader's note created the row. Undefined
   *  means the backend predates the column, and callers fall back to reading
   *  `status` alone. */
  checked_scope?: "page" | "paragraph" | null;
}

/** A project as the website's sidebar loads it. The sidebar shows the name and
 *  the URL carries the slug, so the description is left in the database. */
export type FeedProjectRow = Pick<ProjectRow, "id" | "slug" | "name" | "sort_order">;

/** An item as the website's feed loads it. The feed only names an item on a
 *  filter chip and orders the chips by date, so it reads these columns and
 *  leaves the rest of the row in the database. The body text in particular is
 *  the largest column we have and nothing on the website renders it. */
export type FeedItemRow = Pick<
  ItemRow,
  "id" | "project_id" | "url" | "title" | "published_at" | "created_at"
>;

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

/** One source a note cites, as a note is loaded. It is a row of
 *  everything_note_sources, embedded via a join. Only the link is read here,
 *  because the link is all the note text itself shows. */
export interface NoteSourceRow {
  url: string;
  sort_order: number;
}

/** The body of one citation. `quote` is the passage the verifier copied out of
 *  that source word for word, and it is the only thing the source-details
 *  reveal shows. Sources without a quote have no body to show, so they never
 *  appear here. These rows are fetched when a reader opens the reveal, because
 *  they are large and most readers never open it. */
export interface NoteSourceDetail {
  url: string;
  quote: string;
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
  sources: NoteSourceRow[]; // The note's citation links, joined from everything_note_sources.
  /** Whether any of this note's sources carries a supporting quote. It decides
   *  whether the "Show source details" button appears. The quotes themselves are
   *  fetched only when the reader presses that button. */
  has_source_details: boolean;
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
