/**
 * Long-form filter: keep only posts longer than the free tweet limit (Premium
 * long posts) or X Articles — the "paid" content we run AI-detection on.
 *
 * X caps free posts at 280 characters; `Post.text` already resolves to the full
 * note_tweet body (never the truncated form), so its length is the signal.
 */
import type { Post } from "../../api/fetchEligiblePosts";

const FREE_TWEET_CHAR_LIMIT = 280;

export function isLongForm(post: Post): boolean {
  const isLongText = (post.text?.length ?? 0) > FREE_TWEET_CHAR_LIMIT;
  const isArticle = Boolean((post.raw as any)?.article);
  return isLongText || isArticle;
}
