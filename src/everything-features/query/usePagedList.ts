import { useCallback } from "react";
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import { useLoadMoreSentinel } from "./useLoadMoreSentinel";

/** A list that loads one page at a time from the server, as the reader
 *  scrolls or presses "Show more". Every growing list on the website uses it. */
export interface PagedList<TPage> {
  /** The pages loaded so far, in order. Undefined until the first arrives. */
  pages: TPage[] | undefined;
  /** The first page failed, so there is nothing to show. */
  failed: boolean;
  /** Why the last load failed, while it has. */
  error: Error | null;
  /** A later page failed. The pages above it stay on screen. */
  moreFailed: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  retry: () => void;
  /** Loads the next page, for a list with a "Show more" button. */
  loadMore: () => void;
  /** The element to put after the last entry. When it comes near the screen,
   *  the next page loads. */
  sentinel: (element: HTMLElement | null) => void;
}

/** The bookmark for the page after `page`: its last row, or nothing when the
 *  page came back shorter than a full page, because then it was the last. */
export const afterFullPage = (pageSize: number) => <T>(page: T[]): T | undefined => (page.length === pageSize ? page.at(-1) : undefined);

/** Loads a list page by page with TanStack Query's useInfiniteQuery, which
 *  keeps every loaded page in the cache under one key. `fetchPage` reads one
 *  page from the server, starting after the bookmark it is given, and
 *  `nextBookmark` reads the bookmark for the following page off a page, or
 *  returns undefined after the last one.
 *
 *  A loaded page is never loaded again on its own, so nothing moves under the
 *  reader. Only an explicit refresh, such as the one after a reader posts a
 *  note, reloads the pages. */
export function usePagedList<TPage, TBookmark>({ queryKey, fetchPage, firstBookmark, nextBookmark, enabled = true, keepAfterLeaving = true }: {
  queryKey: QueryKey;
  fetchPage: (bookmark: TBookmark) => Promise<TPage>;
  firstBookmark: TBookmark;
  nextBookmark: (page: TPage) => TBookmark | undefined;
  enabled?: boolean;
  /** False drops the pages once the list leaves the screen, so opening it
   *  again loads it fresh. The note feeds do this, because their order
   *  depends on the votes at the moment they load. */
  keepAfterLeaving?: boolean;
}): PagedList<TPage> {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam as TBookmark),
    initialPageParam: firstBookmark,
    getNextPageParam: nextBookmark,
    enabled,
    ...(keepAfterLeaving ? {} : { gcTime: 0 }),
  });
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  const pages = query.data?.pages;
  return {
    pages,
    failed: query.isError && !pages,
    error: query.error,
    moreFailed: isFetchNextPageError,
    hasMore: hasNextPage,
    loadingMore: isFetchingNextPage,
    retry: () => void (pages ? fetchNextPage() : query.refetch()),
    loadMore,
    sentinel: useLoadMoreSentinel(loadMore, pages?.length ?? 0),
  };
}
