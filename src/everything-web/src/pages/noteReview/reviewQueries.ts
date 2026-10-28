import { useEffect, useState } from "react";
import { useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import {
  fetchReviewDrafts,
  fetchReviewFacets,
  fetchReviewPage,
  fetchReviewSummary,
  REVIEW_PAGE_SIZE,
  type ReviewCursor,
  type ReviewDraft,
} from "@cn/core/claudeReview";
import type { FieldDef, FieldSort, QueryRequest } from "@cn/core/fieldQuery";
import { fetchNotesByIds } from "@cn/core/notes";
import { noteSetOf } from "@cn/features/notes/noteSet";
import { queryKeys } from "@cn/features/query/queryKeys";
import { usePagedList } from "@cn/features/query/usePagedList";
import type { Facet } from "../../components/fieldQuery/Filters";

/* How the review page loads its drafts. The list loads one page of
 * REVIEW_PAGE_SIZE drafts at a time as the admin scrolls, in the request's
 * order. The server pages by a keyset: each page starts just after the sort
 * key of the last draft of the page before it. While the page is open it polls
 * two cheap things: the summary, which says when the newest matching draft
 * was written, and the drafts whose chat waits for Claude's answer. It never
 * reloads the pages on its own. A draft an admin changed is read again and
 * stays where it is, even when it no longer matches the filters, so a card
 * never jumps away under the admin. */

/** How often the page looks for new drafts and for Claude's answers. */
export const REFRESH_MS = 10_000;

/** The most drafts everything_review_drafts reads at once. */
const MAX_DRAFTS_PER_READ = 50;

const chunks = <T>(items: T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

type ListPages = InfiniteData<ReviewDraft[], ReviewCursor | null>;

/** What a card needs from the page: the request its list was loaded with,
 *  the sort levels and the moment its bucket chips are read against, and the
 *  display options that are switched on. */
export interface ReviewView {
  request: QueryRequest;
  sorts: FieldSort[];
  display: string[];
  now: Date;
}

/** The id the website's note box knows a draft's note by while the note is
 *  not on the site. */
export const draftNoteId = (draft: ReviewDraft) => `draft:${draft.id}`;

/** Puts each draft's source quotes into the cache where the note box reads its
 *  "Source details" from, so the box never asks the database for ids that
 *  are not notes. */
export function withSourceDetails(client: QueryClient, drafts: ReviewDraft[]): ReviewDraft[] {
  for (const draft of drafts) {
    client.setQueryData(queryKeys.sourceDetails(draftNoteId(draft)), draft.sources.map((s, i) => ({ ...s, sort_order: i })));
  }
  return drafts;
}

export const useReviewSummary = (request: QueryRequest) =>
  useQuery({ queryKey: queryKeys.noteReviewSummary(request), queryFn: () => fetchReviewSummary(request), refetchInterval: REFRESH_MS, placeholderData: (previous) => previous });

/** The values of the page's choice fields, with how many drafts each would
 *  show, by field id. */
export function useReviewFacets(fields: readonly FieldDef[], request: QueryRequest): Record<string, Facet[]> | undefined {
  const facets = fields.flatMap((field) => (field.kind === "choice" ? [{ column: field.id, labelColumn: field.labelColumn }] : []));
  return useQuery({
    queryKey: queryKeys.noteReviewFacets(request),
    queryFn: async () => {
      const byField = await fetchReviewFacets(request, facets);
      return Object.fromEntries(Object.entries(byField).map(([field, values]) => [field, values.map((v) => ({ value: v.value, label: v.label, count: v.drafts }))]));
    },
    placeholderData: (previous) => previous,
  }).data;
}

/** A page shorter than a full page is the list's last. */
const nextCursor = (page: ReviewDraft[]): ReviewCursor | undefined => {
  const last = page.at(-1);
  return page.length === REVIEW_PAGE_SIZE && last?.sortKey ? { key: last.sortKey, id: last.id } : undefined;
};

export function useReviewList(request: QueryRequest) {
  const client = useQueryClient();
  return usePagedList({
    queryKey: queryKeys.noteReviewList(request),
    fetchPage: async (cursor: ReviewCursor | null) => withSourceDetails(client, await fetchReviewPage(request, cursor)),
    firstBookmark: null as ReviewCursor | null,
    nextBookmark: nextCursor,
  });
}

/** Whether a draft that matches the filters was written after the list
 *  loaded, and the step that loads the list afresh to show it. The summary
 *  says when the newest matching draft was written, and the hook remembers
 *  what that was once the list had loaded. */
export function useNewDrafts(request: QueryRequest, loaded: boolean): { arrived: boolean; showThem: () => void } {
  const client = useQueryClient();
  const newest = useReviewSummary(request).data?.newest ?? null;
  const [newestWhenLoaded, setNewestWhenLoaded] = useState<string | null>(null);
  // Taking the moment during render is React's pattern for state derived from
  // props: React re-renders straight away with it.
  if (loaded && newestWhenLoaded === null && newest !== null) setNewestWhenLoaded(newest);
  return {
    arrived: newestWhenLoaded !== null && newest !== null && newest > newestWhenLoaded,
    showThem: () => {
      setNewestWhenLoaded(newest);
      void client.resetQueries({ queryKey: queryKeys.noteReviewList(request) });
    },
  };
}

/** Reads drafts again and puts the fresh copies into the list where they
 *  were, with their old place in the order, so the next page still starts
 *  after the right draft. */
export async function refreshDrafts(client: QueryClient, request: QueryRequest, ids: string[]) {
  if (ids.length === 0) return;
  const byId = new Map(withSourceDetails(client, await fetchReviewDrafts(ids)).map((d) => [d.id, d]));
  client.setQueryData<ListPages>(queryKeys.noteReviewList(request), (data) =>
    data && { ...data, pages: data.pages.map((page) => page.map((d) => (byId.has(d.id) ? { ...byId.get(d.id)!, sortKey: d.sortKey } : d))) },
  );
  await client.invalidateQueries({ queryKey: queryKeys.noteReviewCounts });
}

/** Reads again every draft on screen by one creator, after their X account
 *  changed. */
export function refreshCreator(client: QueryClient, request: QueryRequest, creatorSlug: string) {
  const pages = client.getQueryData<ListPages>(queryKeys.noteReviewList(request))?.pages ?? [];
  const ids = pages.flat().filter((draft) => draft.post.creatorSlug === creatorSlug).map((draft) => draft.id);
  return Promise.all(chunks(ids, MAX_DRAFTS_PER_READ).map((part) => refreshDrafts(client, request, part)));
}

/** Whether the draft's last chat message is a reviewer's, still waiting for
 *  Claude's answer. */
export const waitsForClaude = (draft: ReviewDraft) => (draft.messages.at(-1)?.actor ?? "claude") !== "claude";

/** Polls the drafts on screen whose chat waits for Claude, so Claude's answer
 *  and any proposal it made show up without a reload. */
export function usePollWaitingChats(request: QueryRequest, drafts: ReviewDraft[]) {
  const client = useQueryClient();
  const waitingIds = drafts.filter(waitsForClaude).map((d) => d.id).join(",");
  useEffect(() => {
    if (!waitingIds) return;
    const timer = setInterval(() => void refreshDrafts(client, request, waitingIds.split(",")), REFRESH_MS);
    return () => clearInterval(timer);
  }, [client, request, waitingIds]);
}

/** The live notes of the drafts on screen, with their current votes. */
export function useLiveNotes(drafts: ReviewDraft[]) {
  const noteIds = drafts.flatMap((d) => (d.noteId ? [d.noteId] : []));
  return useQuery({
    queryKey: queryKeys.noteReviewNoteSet(noteIds),
    queryFn: async () => noteSetOf(await fetchNotesByIds(noteIds), []),
    enabled: noteIds.length > 0,
    placeholderData: (previous) => previous,
  }).data?.notes;
}
