import { useEffect } from "react";
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import {
  fetchReviewDrafts,
  fetchReviewPage,
  fetchReviewSummary,
  REVIEW_PAGE_SIZE,
  type ReviewCursor,
  type ReviewDraft,
  type ReviewSection,
} from "@cn/core/claudeReview";
import { fetchNotesByIds } from "@cn/core/notes";
import { noteSetOf } from "@cn/features/notes/noteSet";
import { queryKeys } from "@cn/features/query/queryKeys";

/* How the review page loads its drafts. A section loads one page of
 * REVIEW_PAGE_SIZE drafts at a time as the admin scrolls, newest first. The
 * server pages by a keyset: each page starts just after the last draft of the
 * page before it. The sidebar's counts come from one small summary call. While
 * the page is open it polls three cheap things: the summary, the newest page
 * of the open section, and the drafts whose chat waits for Claude's answer. It
 * never reloads every page it has shown. */

/** How often the page looks for new drafts and for Claude's answers. */
export const REFRESH_MS = 10_000;

type SectionPages = InfiniteData<ReviewDraft[], ReviewCursor | null>;

/** The id the website's note box knows a draft's note by while the note is
 *  not on the site. */
export const draftNoteId = (draft: ReviewDraft) => `draft:${draft.id}`;

/** Puts each draft's source quotes into the cache where the note box reads its
 *  "Source details" from, so the box never asks the database for ids that
 *  are not notes. */
function withSourceDetails(client: QueryClient, drafts: ReviewDraft[]): ReviewDraft[] {
  for (const draft of drafts) {
    client.setQueryData(queryKeys.sourceDetails(draftNoteId(draft)), draft.sources.map((s, i) => ({ ...s, sort_order: i })));
  }
  return drafts;
}

export const useReviewSummary = (enabled: boolean) =>
  useQuery({ queryKey: queryKeys.noteReviewSummary, queryFn: fetchReviewSummary, enabled, refetchInterval: REFRESH_MS });

/** A page shorter than a full page is the section's last. */
const nextCursor = (page: ReviewDraft[]): ReviewCursor | undefined => {
  const last = page.at(-1);
  return page.length === REVIEW_PAGE_SIZE && last ? { createdAt: last.createdAt, id: last.id } : undefined;
};

export function useReviewSection(section: ReviewSection, enabled: boolean) {
  const client = useQueryClient();
  return useInfiniteQuery({
    queryKey: queryKeys.noteReviewSection(section),
    queryFn: async ({ pageParam }) => withSourceDetails(client, await fetchReviewPage(section, pageParam)),
    initialPageParam: null as ReviewCursor | null,
    getNextPageParam: nextCursor,
    enabled,
  });
}

/** Drafts that reached the section after it was loaded. The newest page is
 *  polled, and whatever in it is newer than the section's first draft is new. */
export function useNewDrafts(section: ReviewSection, shown: ReviewDraft[] | undefined): ReviewDraft[] {
  const client = useQueryClient();
  const newest = useQuery({
    queryKey: queryKeys.noteReviewNewest(section),
    queryFn: async () => withSourceDetails(client, await fetchReviewPage(section, null)),
    enabled: shown !== undefined,
    refetchInterval: REFRESH_MS,
  });
  const first = shown?.[0];
  return (newest.data ?? []).filter((d) => !first || d.createdAt > first.createdAt);
}

/** Puts new drafts at the top of the section. */
export function showNewDrafts(client: QueryClient, section: ReviewSection, drafts: ReviewDraft[]) {
  client.setQueryData<SectionPages>(queryKeys.noteReviewSection(section), (data) =>
    data && { ...data, pages: [[...drafts, ...(data.pages[0] ?? [])], ...data.pages.slice(1)] },
  );
}

/** Replaces drafts the section shows with fresher copies. */
function mergeDrafts(client: QueryClient, section: ReviewSection, fresh: ReviewDraft[]) {
  const byId = new Map(fresh.map((d) => [d.id, d]));
  client.setQueryData<SectionPages>(queryKeys.noteReviewSection(section), (data) =>
    data && { ...data, pages: data.pages.map((page) => page.map((d) => byId.get(d.id) ?? d)) },
  );
}

/** Takes a draft out of the section, after an admin's step moved it to
 *  another one. */
export function dropDraft(client: QueryClient, section: ReviewSection, draftId: string) {
  client.setQueryData<SectionPages>(queryKeys.noteReviewSection(section), (data) =>
    data && { ...data, pages: data.pages.map((page) => page.filter((d) => d.id !== draftId)) },
  );
}

/** Reads drafts again and puts the fresh copies into the section. */
export async function refreshDrafts(client: QueryClient, section: ReviewSection, ids: string[]) {
  if (ids.length > 0) mergeDrafts(client, section, withSourceDetails(client, await fetchReviewDrafts(ids)));
}

/** Whether the draft's last chat message is a reviewer's, still waiting for
 *  Claude's answer. */
export const waitsForClaude = (draft: ReviewDraft) => (draft.messages.at(-1)?.actor ?? "claude") !== "claude";

/** Polls the drafts on screen whose chat waits for Claude, so Claude's answer
 *  and any rewrite it made show up without a reload. */
export function usePollWaitingChats(section: ReviewSection, drafts: ReviewDraft[]) {
  const client = useQueryClient();
  const waitingIds = drafts.filter(waitsForClaude).map((d) => d.id).join(",");
  useEffect(() => {
    if (!waitingIds) return;
    const timer = setInterval(() => void refreshDrafts(client, section, waitingIds.split(",")), REFRESH_MS);
    return () => clearInterval(timer);
  }, [client, section, waitingIds]);
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
