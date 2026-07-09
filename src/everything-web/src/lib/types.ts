export interface ItemRow {
  id: string;
  source: "youtube" | "substack";
  url: string;
  title: string | null;
  published_at: string | null;
  status: "queued" | "processing" | "done" | "error";
  error: string | null;
  created_at: string;
}

export interface ClaimRow {
  id: string;
  item_id: string;
  claim: string;
  judgement: string;
  context_quote: string;
  context_url: string | null;
  start_seconds: number | null;
  end_seconds: number | null;
  status: "pending" | "skipped" | "no_note" | "note" | "error";
  status_reason: string | null;
}

export interface NoteRow {
  id: string;
  claim_id: string;
  note: string;
  sources: string[];
  helpful_count: number;
  not_helpful_count: number;
  created_at: string;
}
