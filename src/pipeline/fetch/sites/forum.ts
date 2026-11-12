/**
 * LessWrong and the Alignment Forum. Both sites run ForumMagnum, the same
 * open-source forum software, and expose the same public GraphQL API at
 * /graphql, which answers with a post's full HTML body. An author's feed URL
 * is their profile page, so https://www.lesswrong.com/users/<slug>. The two
 * sites share their user accounts: the same slug works on both, and the
 * Alignment Forum lists only the posts that are tagged for it.
 *
 * Every query is a GET request through readApi, so a forum behind a bot check
 * is read the same way as any other API.
 */

import type { PageRead } from "../../../service/contract";
import { htmlToText } from "../../utils/html";
import { readJsonApi } from "../readApi";

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

export interface ForumAuthorFeed {
  origin: string;
  slug: string;
}

/** Reads the author slug out of a profile URL, so
 *  "https://www.lesswrong.com/users/zvi" gives { origin, slug: "zvi" }. A URL
 *  that is not a forum profile gives null. */
export function parseAuthorFeedUrl(feedUrl: string): ForumAuthorFeed | null {
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

type GraphqlRead = { type: "data"; data: any } | { type: "unreadable"; reason: string };

/** Runs one query, sent as a GET request because Jina Reader, the last step
 *  of readApi, can only make GET requests. A GraphQL error, such as an unknown
 *  post id, comes back as unreadable too. */
async function readGraphql(origin: string, query: string): Promise<GraphqlRead> {
  const read = await readJsonApi(`${origin}/graphql?query=${encodeURIComponent(query)}`);
  if (read.type === "unreadable") return read;
  const body = read.json as { data?: unknown; errors?: { message: string }[] };
  if (body.errors?.length) return { type: "unreadable", reason: `GraphQL error from ${origin}: ${body.errors[0]!.message}` };
  return { type: "data", data: body.data };
}

/** A listing must not quietly come back empty, so any failure throws. */
async function graphqlData(origin: string, query: string): Promise<any> {
  const read = await readGraphql(origin, query);
  if (read.type === "unreadable") throw new Error(`${origin}/graphql: ${read.reason}`);
  return read.data;
}

/** Reads one post, the first stage of readPage. Null means the API did not
 *  give the post, and readPage goes on to the fetch ladder. */
export async function readForumPost(post: { origin: string; postId: string }, url: string): Promise<PageRead | null> {
  const read = await readGraphql(
    post.origin,
    `{ post(input: {selector: {_id: "${post.postId}"}}) {
        result { _id pageUrl title postedAt htmlBody shortform user { displayName slug } } } }`,
  );
  if (read.type === "unreadable") {
    console.log(`  the forum's API did not give ${url} (${read.reason}), trying the fetch ladder`);
    return null;
  }
  const result = read.data.post?.result;
  if (result?.shortform) return { type: "shortform" };
  if (!result?.htmlBody?.trim()) return null;
  return {
    type: "page",
    page: {
      url: result.pageUrl ?? url,
      title: result.title ?? null,
      text: htmlToText(result.htmlBody),
      publishedAt: result.postedAt ?? null,
      authorName: result.user?.displayName ?? null,
      source: { kind: "forum", htmlBody: result.htmlBody, authorFeedUrl: result.user?.slug ? `${post.origin}/users/${result.user.slug}` : null },
    },
  };
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

/** An author's name, picture and latest posts. */
export interface ForumListing {
  authorName: string | null;
  /** Null when they never uploaded a picture. */
  imageUrl: string | null;
  /** Newest first. */
  posts: ForumPost[];
}

/** Profile pictures on both sites are Cloudinary uploads. This asks
 *  Cloudinary for a square crop around the face, the size of a thumbnail. */
const profileImageUrl = (imageId: string) => `https://res.cloudinary.com/lesswrong-2-0/image/upload/c_fill,g_face,w_240,h_240/${imageId}`;

/** The author's latest `limit` posts. A post with no body, such as a bare
 *  link post or an announced event, carries nothing to fact-check and is left
 *  out. */
export async function readForumAuthor(author: ForumAuthorFeed, limit: number): Promise<ForumListing> {
  const userData = await graphqlData(author.origin, `{ user(input: {selector: {slug: "${author.slug}"}}) { result { _id displayName profileImageId } } }`);
  const user = userData.user?.result;
  if (!user?._id) throw new Error(`No user ${author.slug} on ${author.origin}`);
  const postsData = await graphqlData(
    author.origin,
    `{ posts(input: {terms: {view: "userPosts", userId: "${user._id}", limit: ${limit}}}) {
        results { _id pageUrl title postedAt htmlBody } } }`,
  );
  const posts = (postsData.posts?.results ?? [])
    .filter((p: any) => p.htmlBody?.trim())
    .map((p: any) => ({ postId: p._id, url: p.pageUrl, title: p.title, postedAt: p.postedAt, text: htmlToText(p.htmlBody) }));
  return { authorName: user.displayName ?? null, imageUrl: user.profileImageId ? profileImageUrl(user.profileImageId) : null, posts };
}
