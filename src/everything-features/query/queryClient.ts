import { QueryClient } from "@tanstack/react-query";

/** The cache of server data, one per JavaScript context: the website's page,
 *  the extension's popup, or one content script with all of its overlays.
 *  Every React root in that context shares it, so a vote cast in one overlay
 *  shows in the others.
 *
 *  Nothing goes stale by time. The website hears about changes over its
 *  realtime channel, and every mutation refreshes what it changed, so an
 *  automatic refetch on window focus would only reload a whole project's
 *  notes for nothing.
 *
 *  A failed query is tried once more. The Supabase client already retries a
 *  read that failed on the network or with a server error, with growing waits
 *  (`@cn/core/retry`). That client only retries GET requests, and a database
 *  function call is a POST request, so this extra try is the only retry such
 *  a call gets. The extra try also applies to queries run with fetchQuery. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: 1 },
  },
});
