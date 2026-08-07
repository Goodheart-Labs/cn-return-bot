/**
 * The long-form filter. It keeps only the posts we run AI detection on, which is
 * the paid content. That means the long posts Premium accounts can write and X
 * Articles.
 *
 * X caps a free post at 280 characters, so length alone tells the two apart.
 * `Post.text` always holds the full note_tweet body and never the truncated
 * form, so its length is the signal we can rely on.
 */
import type { Post } from "../../api/fetchEligiblePosts";

const FREE_TWEET_CHAR_LIMIT = 280;

export function isLongForm(post: Post): boolean {
  const isLongText = (post.text?.length ?? 0) > FREE_TWEET_CHAR_LIMIT;
  const isArticle = Boolean((post.raw as any)?.article);
  return isLongText || isArticle;
}
