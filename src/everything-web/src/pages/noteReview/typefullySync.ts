import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchScheduledPosts, updateXPost } from "@cn/core/xMarks";
import { queryKeys } from "@cn/features/query/queryKeys";
import { fetchDraftStates, TWEET_SERVER } from "./tweetServer";

/** How often the local posting tool asks Typefully about the scheduled
 *  notes. */
const SYNC_INTERVAL_MS = 5 * 60_000;

/** The database and Typefully write the same moment in different forms. */
const sameMoment = (a: string | null, b: string | null) => a === b || (a !== null && b !== null && Date.parse(a) === Date.parse(b));

/** Keeps the scheduled notes in step with Typefully while the local posting
 *  tool is open: when it opens and every few minutes after. A published
 *  tweet makes its note posted, and a deleted draft makes its note not posted
 *  again. Only a mark that changed is written, and then the review page
 *  reloads its notes. Returns how many tweets Typefully could not publish. */
export function useTypefullySync() {
  const client = useQueryClient();
  return useQuery({
    queryKey: queryKeys.typefullySync,
    enabled: !!TWEET_SERVER,
    refetchInterval: SYNC_INTERVAL_MS,
    queryFn: async () => {
      const posts = await fetchScheduledPosts();
      if (posts.length === 0) return { failed: 0 };
      const states = await fetchDraftStates(posts.map((post) => post.draftId));
      let failed = 0;
      let changed = false;
      for (const post of posts) {
        const draft = states[post.draftId]!;
        if (draft.state === "failed") failed++;
        else if (draft.state !== "scheduled" || !sameMoment(draft.scheduledFor, post.scheduledFor)) {
          await updateXPost(post, draft);
          changed = true;
        }
      }
      if (changed) await client.invalidateQueries({ queryKey: queryKeys.noteReview });
      return { failed };
    },
  });
}
