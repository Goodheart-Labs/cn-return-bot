/**
 * LessWrong and Alignment Forum ingestion. Both sites run ForumMagnum, the
 * same open-source forum codebase, and expose the same public GraphQL API at
 * /graphql. Nothing here scrapes a rendered page; the API answers with a
 * post's full HTML body. An author's feed URL is their profile page, so
 * https://www.lesswrong.com/users/<slug>, and the two sites share their user
 * accounts: the same slug works on both, and the Alignment Forum lists only
 * the posts that are tagged for it.
 */

import type { FetchedContent } from "../types";
import { htmlToText } from "./substack";

/** The canonical origin for a LessWrong or Alignment Forum URL, or null when
 *  the URL belongs to neither site. */
export function forumOrigin(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    if (/(^|\.)lesswrong\.com$/.test(hostname)) return "https://www.lesswrong.com";
    if (/(^|\.)alignmentforum\.org$/.test(hostname)) return "https://www.alignmentforum.org";
  } catch {
    return null;
  }
  return null;
}

/** Reads the author slug out of a profile URL, so
 *  "https://www.lesswrong.com/users/zvi" gives { origin, slug: "zvi" }. A URL
 *  that is not a forum profile gives null. */
export function parseAuthorFeedUrl(feedUrl: string): { origin: string; slug: string } | null {
  const origin = forumOrigin(feedUrl);
  if (!origin) return null;
  const slug = new URL(feedUrl).pathname.match(/^\/users\/([\w.-]+)\/?$/)?.[1];
  return slug ? { origin, slug } : null;
}

/** Reads the post id out of a post URL, so
 *  ".../posts/KgwQchapx4vJDhfYC/generalized-atheism" gives its id. Null when
 *  the URL is not a forum post. */
export function parsePostUrl(url: string): { origin: string; postId: string } | null {
  const origin = forumOrigin(url);
  if (!origin) return null;
  const postId = new URL(url).pathname.match(/^\/posts\/(\w+)(\/|$)/)?.[1];
  return postId ? { origin, postId } : null;
}

async function graphql(origin: string, query: string): Promise<any> {
  const res = await fetch(`${origin}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "common-notes-pipeline" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${origin}/graphql`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(`GraphQL error from ${origin}: ${body.errors[0].message}`);
  return body.data;
}

export interface ForumPost {
  /** ForumMagnum's post id. Post URLs contain it, and it is the same id on
   *  both sites when a post appears on both, which is what lets the walker
   *  recognize an Alignment Forum post it already checked via LessWrong. */
  postId: string;
  url: string;
  title: string;
  /** ISO timestamp of publication. */
  postedAt: string;
  /** Post body as plain text with inline image markers. */
  text: string;
}

const postToEntry = (p: any): ForumPost => ({
  postId: p._id,
  url: p.pageUrl,
  title: p.title,
  postedAt: p.postedAt,
  text: htmlToText(p.htmlBody, true),
});

/** Latest N posts of an author's feed URL, newest first, together with the
 *  author's display name. A post with no body, such as a bare link post or an
 *  announced event, carries nothing to fact-check and is left out. */
export async function fetchAuthorPosts(feedUrl: string, n: number): Promise<{ authorName?: string; posts: ForumPost[] }> {
  const author = parseAuthorFeedUrl(feedUrl);
  if (!author) throw new Error(`Not a LessWrong or Alignment Forum author URL: ${feedUrl}`);
  const userData = await graphql(
    author.origin,
    `{ user(input: {selector: {slug: "${author.slug}"}}) { result { _id displayName } } }`,
  );
  const user = userData.user?.result;
  if (!user?._id) throw new Error(`No user found for ${feedUrl}`);
  const postsData = await graphql(
    author.origin,
    `{ posts(input: {terms: {view: "userPosts", userId: "${user._id}", limit: ${n}}}) {
        results { _id pageUrl title postedAt htmlBody } } }`,
  );
  const posts = (postsData.posts?.results ?? []).filter((p: any) => p.htmlBody?.trim()).map(postToEntry);
  return { authorName: user.displayName ?? undefined, posts };
}

/** Fetches one post by its URL, for an item that was enqueued without its body.
 *  It comes back as the plain article-text content kind, the same one every
 *  non-YouTube source uses. */
export async function fetchForumPost(url: string): Promise<FetchedContent> {
  const parsed = parsePostUrl(url);
  if (!parsed) throw new Error(`Not a LessWrong or Alignment Forum post URL: ${url}`);
  const data = await graphql(
    parsed.origin,
    `{ post(input: {selector: {_id: "${parsed.postId}"}}) {
        result { _id pageUrl title postedAt htmlBody user { displayName } } } }`,
  );
  const post = data.post?.result;
  if (!post?.htmlBody) throw new Error(`No post body for ${url}`);
  const entry = postToEntry(post);
  return {
    kind: "substack",
    url: entry.url,
    title: entry.title,
    publishedAt: entry.postedAt,
    text: entry.text,
    authorName: post.user?.displayName ?? undefined,
  };
}
