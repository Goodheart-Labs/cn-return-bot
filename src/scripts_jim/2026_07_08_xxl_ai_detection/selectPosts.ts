/**
 * From the raw eligible feed, keep only long-form (paid/premium) posts, then
 * rank them by a 50/50 blend of recency and views and take the top N.
 *
 * Long-form filter: X caps free posts at 280 characters; anything longer is a
 * Premium long post or an Article. `Post.text` already resolves to the full
 * note_tweet body (never the truncated form), so its length is the signal.
 */
import type { Post } from "../../api/fetchEligiblePosts";
import { ageInHours } from "../../pipeline/orchestration/utils/tweetSorting";

const FREE_TWEET_CHAR_LIMIT = 280;
const RECENCY_WEIGHT = 0.5;
const VIEWS_WEIGHT = 0.5;

export function isLongForm(post: Post, minChars: number = FREE_TWEET_CHAR_LIMIT): boolean {
  const isLongText = (post.text?.length ?? 0) > minChars;
  const isArticle = Boolean((post.raw as any)?.article);
  return isLongText || isArticle;
}

function recencyScore(post: Post, maxAgeHours: number): number {
  return 1 - Math.min(ageInHours(post), maxAgeHours) / maxAgeHours;
}

function viewsScore(post: Post, maxLogViews: number): number {
  if (maxLogViews <= 0) return 0;
  const views = post.public_metrics?.impression_count ?? 0;
  return Math.log10(views + 1) / maxLogViews;
}

/** Sort by 50/50 recency+views. Views are log-normalized against the batch max. */
export function sortByRecencyAndViews(posts: Post[]): Post[] {
  const maxAgeHours = posts.reduce((max, p) => Math.max(max, ageInHours(p)), 1);
  const maxLogViews = posts.reduce(
    (max, p) => Math.max(max, Math.log10((p.public_metrics?.impression_count ?? 0) + 1)),
    0
  );
  const score = (p: Post) =>
    RECENCY_WEIGHT * recencyScore(p, maxAgeHours) + VIEWS_WEIGHT * viewsScore(p, maxLogViews);
  return [...posts].sort((a, b) => score(b) - score(a));
}

export type Selection = {
  totalFetched: number;
  longFormCount: number;
  selected: Post[];
};

export function selectLongFormPosts(posts: Post[], topN: number, minChars: number): Selection {
  const longForm = posts.filter((p) => isLongForm(p, minChars));
  const selected = sortByRecencyAndViews(longForm).slice(0, topN);
  return { totalFetched: posts.length, longFormCount: longForm.length, selected };
}
