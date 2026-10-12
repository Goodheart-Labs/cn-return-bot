import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { NoteRow, NoteSourceDetail } from "@cn/core/types";
import { queryKeys } from "@cn/features/query/queryKeys";
import type { Article, LabClaim, LabNote, LabRun, RunIndexEntry } from "../../labRun";

/** The runner scripts write these files into public/, so they are served as
 *  they are. No caching, because a new run should show up on reload. */
async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
}

export const useArticle = () => useQuery({ queryKey: ["article"], queryFn: () => fetchJson<Article>("article.json") });
export const useRunIndex = () => useQuery({ queryKey: ["runIndex"], queryFn: () => fetchJson<RunIndexEntry[]>("runs/index.json") });
export const useRun = (runId: string | null) =>
  useQuery({ queryKey: ["run", runId], queryFn: () => fetchJson<LabRun>(`runs/${runId}.json`), enabled: runId !== null });

/** The shared note card reads a note in the database's row shape. */
export function toNoteRow(note: LabNote, claim: LabClaim): NoteRow {
  return {
    id: note.id,
    claim_id: claim.id,
    note: note.text,
    sources: note.sources.map((s, i) => ({ url: s.url, sort_order: i })),
    has_source_details: note.sources.some((s) => s.quote),
    helpful_count: note.votes.helpful,
    somewhat_helpful_count: note.votes.somewhatHelpful,
    not_helpful_count: note.votes.notHelpful,
    author_id: note.isAi ? null : "reader",
    author_name: note.author,
    improved_from_note_id: note.improvedFromNoteId,
    status: note.status,
    created_at: note.createdAt,
    claim: {
      id: claim.id,
      item_id: "lab",
      claim: claim.claim,
      context_quote: claim.contextQuote,
      context_paragraph: claim.contextParagraph,
      image_urls: claim.imageUrls,
      updated_quote: null,
      context_url: null,
      start_seconds: null,
      end_seconds: null,
    },
  };
}

/** The note card fetches a note's source quotes the first time its reveal
 *  opens. The lab already has them in the run file, so they go straight into
 *  the cache under the key the card reads, and the card never fetches. */
export function seedSourceDetails(queryClient: QueryClient, run: LabRun): void {
  for (const claim of run.claims) {
    for (const note of claim.notes) {
      const details: NoteSourceDetail[] = note.sources.flatMap((s, i) =>
        s.quote ? [{ url: s.url, quote: s.quote, explanation: s.explanation, sort_order: i }] : [],
      );
      queryClient.setQueryData(queryKeys.sourceDetails(note.id), details);
    }
  }
}
