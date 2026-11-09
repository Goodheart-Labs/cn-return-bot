/**
 * Substack posts, also on a publication's own domain such as normaltech.ai.
 * Substack's post endpoint, /api/v1/posts/<slug>, answers with the clean body
 * and every other field in one answer, so readPage asks it before reading the
 * page itself.
 */

import type { PageRead } from "../../../service/contract";
import { htmlToText } from "../../utils/html";
import { readJsonApi } from "../readApi";

export interface SubstackPublication {
  id: number;
  name: string;
  subdomain: string;
}

/** The fields of Substack's /api/v1/posts/<slug> answer that we use. */
export interface SubstackPost {
  title: string;
  subtitle: string | null;
  post_date: string | null;
  cover_image: string | null;
  canonical_url: string | null;
  body_html: string;
  publication_id: number;
  publishedBylines: { name: string; publicationUsers?: { publication?: SubstackPublication }[] }[];
}

const SUBSTACK_POST_PATH = /^\/p\/([\w-]+)\/?$/;

/** A paid post or a podcast post answers without a body. */
function isSubstackPostWithBody(json: unknown): json is SubstackPost {
  const post = json as Partial<SubstackPost> | null;
  return typeof post?.body_html === "string" && post.body_html.trim() !== "" && typeof post.title === "string" && Array.isArray(post.publishedBylines);
}

/** The publication the post belongs to. Its bylines list every publication its
 *  authors write for, so the one with the post's own publication id is the
 *  right one. */
export function postPublication(post: SubstackPost): SubstackPublication | null {
  const publications = post.publishedBylines.flatMap((byline) => byline.publicationUsers ?? []).map((user) => user.publication);
  return publications.find((publication) => publication?.id === post.publication_id) ?? null;
}

/** Any address of the shape /p/<slug> may be a Substack post on a custom
 *  domain, so the post endpoint is asked first. Null means the answer was no
 *  Substack post with a body: the site is not Substack, the post is paid, or
 *  the endpoint could not be read. readPage then goes on to the fetch ladder. */
export async function readSubstackPost(url: string): Promise<PageRead | null> {
  const { origin, pathname } = new URL(url);
  const slug = SUBSTACK_POST_PATH.exec(pathname)?.[1];
  if (!slug) return null;
  const read = await readJsonApi(`${origin}/api/v1/posts/${slug}`);
  if (read.type === "unreadable" || !isSubstackPostWithBody(read.json)) return null;
  const post = read.json;
  return {
    type: "page",
    page: {
      url: post.canonical_url ?? url,
      title: post.title,
      text: htmlToText(post.body_html),
      publishedAt: post.post_date,
      authorName: postPublication(post)?.name ?? null,
      source: { kind: "substack", post },
    },
  };
}
