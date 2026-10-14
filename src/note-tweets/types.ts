import type { NoteTallyFields } from "@cn/core/noteBelief";
import type { NoteStatus } from "@cn/core/noteScore";

export type Jim = { bucket?: "send" | "uncertain"; pick?: string; comment?: string; sendInstead?: string };
export interface Note extends NoteTallyFields {
  id: string;
  note: string;
  sources: { url: string; sort_order: number }[];
  created_at: string;
  everything_claims: {
    claim: string;
    context_quote: string | null;
    context_paragraph: string | null;
    updated_quote: string | null;
    context_url: string | null;
    everything_items: {
      title: string;
      url: string;
      published_at: string | null;
      everything_projects: { slug: string; name: string } | null;
    } | null;
  } | null;
}
export type ScoredNote = Note & { votes: number; p: number; status: NoteStatus };
export type Article = { key: string; title: string; ids: Set<string> };
export type FeedNote = {
  id: string; slug?: string; project?: string; host: string; url: string;
  quote: string; note: string; title: string; published_at: string | null;
  helpful: number; updated_quote: string | null; jim: Jim | null;
};
export type FeedData = Record<string, FeedNote>;
export type Staged = { id: string; author: string; jim: string; text: string; reply?: string; published?: string | null; timing?: "slot" | "now"; shot: "pending" | "ready" | "failed"; status: "staged" | "sent" | "error"; draft_id?: string; scheduled?: string | null; error?: string };
