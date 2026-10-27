import { useEffect } from "react";
import { useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import {
  fetchReviewDrafts,
  fetchReviewPage,
  fetchReviewSummary,
  REVIEW_PAGE_SIZE,
  type CrowdRating,
  type ReviewCursor,
  type ReviewDraft,
  type ReviewSection,
} from "@cn/core/claudeReview";
import { fetchNotesByIds } from "@cn/core/notes";
import { noteSetOf } from "@cn/features/notes/noteSet";
import { queryKeys } from "@cn/features/query/queryKeys";
import { usePagedList } from "@cn/features/query/usePagedList";

/* How the review page loads its drafts. A section loads one page of
 * REVIEW_PAGE_SIZE drafts at a time as the admin scrolls, newest first, under
 * the crowd-rating filter the admin picked. The server pages by a keyset: each
 * page starts just after the last draft of the page before it. The sidebar's
 * counts come from one small summary call. While the page is open it polls
 * three cheap things: the summary, the newest page of the open section, and
 * the drafts whose chat waits for Claude's answer. It never reloads every page
 * it has shown. */

/** How often the page looks for new drafts and for Claude's answers. */
export const REFRESH_MS = 10_000;

/** What the page shows: one section under one crowd-rating filter. */
export interface ReviewView {
  section: ReviewSection;
  ratings: CrowdRating[];
}

type SectionPages = InfiniteData<ReviewDraft[], ReviewCursor | null>;

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

export const useReviewSummary = (ratings: CrowdRating[]) =>
  useQuery({ queryKey: queryKeys.noteReviewSummary(ratings), queryFn: () => fetchReviewSummary(ratings), refetchInterval: REFRESH_MS, placeholderData: (previous) => previous });

/** A page shorter than a full page is the section's last. */
const nextCursor = (page: ReviewDraft[]): ReviewCursor | undefined => {
  const last = page.at(-1);
  return page.length === REVIEW_PAGE_SIZE && last ? { createdAt: last.createdAt, id: last.id } : undefined;
};

export function useReviewSection({ section, ratings }: ReviewView) {
  const client = useQueryClient();
  return usePagedList({
    queryKey: queryKeys.noteReviewSection(section, ratings),
    fetchPage: async (cursor: ReviewCursor | null) => withSourceDetails(client, await fetchReviewPage(section, ratings, cursor)),
    firstBookmark: null as ReviewCursor | null,
    nextBookmark: nextCursor,
  });
}

/** Drafts that reached the section after it was loaded. The newest page is
 *  polled, and whatever in it is newer than the section's first draft is new. */
export function useNewDrafts({ section, ratings }: ReviewView, shown: ReviewDraft[] | undefined): ReviewDraft[] {
  const client = useQueryClient();
  const newest = useQuery({
    queryKey: queryKeys.noteReviewNewest(section, ratings),
    queryFn: async () => withSourceDetails(client, await fetchReviewPage(section, ratings, null)),
    enabled: shown !== undefined,
    refetchInterval: REFRESH_MS,
  });
  const first = shown?.[0];
  return (newest.data ?? []).filter((d) => !first || d.createdAt > first.createdAt);
}

const setSection = (client: QueryClient, view: ReviewView, change: (pages: ReviewDraft[][]) => ReviewDraft[][]) =>
  client.setQueryData<SectionPages>(queryKeys.noteReviewSection(view.section, view.ratings), (data) => data && { ...data, pages: change(data.pages) });

/** Puts new drafts at the top of the section. */
export function showNewDrafts(client: QueryClient, view: ReviewView, drafts: ReviewDraft[]) {
  setSection(client, view, (pages) => [[...drafts, ...(pages[0] ?? [])], ...pages.slice(1)]);
}

/** Takes a draft out of the section, after an admin's step moved it to
 *  another one, and drops the cached other sections, so they load fresh when
 *  opened. */
export function dropDraft(client: QueryClient, view: ReviewView, draftId: string) {
  setSection(client, view, (pages) => pages.map((page) => page.filter((d) => d.id !== draftId)));
  client.removeQueries({ queryKey: queryKeys.noteReviewSections, predicate: (q) => q.queryKey[2] !== view.section });
}

/** Reads drafts again and puts the fresh copies into the section, where they
 *  stay even when the step moved them to another section, so the card does
 *  not jump away under the admin. */
export async function refreshDrafts(client: QueryClient, view: ReviewView, ids: string[]) {
  if (ids.length === 0) return;
  const byId = new Map(withSourceDetails(client, await fetchReviewDrafts(ids)).map((d) => [d.id, d]));
  setSection(client, view, (pages) => pages.map((page) => page.map((d) => byId.get(d.id) ?? d)));
}

/** Whether the draft's last chat message is a reviewer's, still waiting for
 *  Claude's answer. */
export const waitsForClaude = (draft: ReviewDraft) => (draft.messages.at(-1)?.actor ?? "claude") !== "claude";

/** Polls the drafts on screen whose chat waits for Claude, so Claude's answer
 *  and any proposal it made show up without a reload. */
export function usePollWaitingChats(view: ReviewView, drafts: ReviewDraft[]) {
  const client = useQueryClient();
  const waitingIds = drafts.filter(waitsForClaude).map((d) => d.id).join(",");
  useEffect(() => {
    if (!waitingIds) return;
    const timer = setInterval(() => void refreshDrafts(client, view, waitingIds.split(",")), REFRESH_MS);
    return () => clearInterval(timer);
  }, [client, view, waitingIds]);
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
