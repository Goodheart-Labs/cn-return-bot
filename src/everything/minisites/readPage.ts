/* Reads an article for a minisite: its title, description, byline, date,
 * picture and text. A Substack post, also on a custom domain such as
 * normaltech.ai, comes from Substack's own post endpoint, which returns the
 * clean body and every field in one answer. Any other page goes through the
 * fetch ladder, and Readability finds the article in its HTML. Both paths run
 * the article HTML through the same converter to reader text.
 *
 * Every network request goes through fetchWebPageHtml and fetchJson, so on the
 * services box the sandboxed fetcher makes them. */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { parseReaderText, plainText, withoutRepeatedHeader } from "../../everything-core/readerText";
import { fetchJson, fetchWebPageHtml } from "../../pipeline/tool-calling/tools";
import { isWebUrl } from "../../pipeline/utils/webUrl";
import { canonicalSubstackFeed, substackFeedInPageHtml, substackFeedOfPage } from "../feedUrls";
import { htmlToReaderBlocks } from "./htmlToReaderText";

/** What a read_page job writes into its result, and what
 *  everything_create_minisite reads back from it. */
export interface MinisitePage {
  title: string;
  description: string;
  byline: string | null;
  published_at: string | null;
  image_url: string | null;
  /** The article in reader text. */
  content: string;
  /** The same words for the pipeline, from plainText(). */
  plain_text: string;
  /** The creator's feed in the form everything_projects.feed_url uses, when
   *  the page names one we can follow. */
  creator_feed_url: string | null;
}

/** A failure whose message is one plain sentence the website can show the
 *  admin as it is. */
export class PageReadError extends Error {}

// The limits of the matching columns of everything_minisites (migration 117).
// A longer value would make the create fail, so it is cut here.
const MAX_TITLE_CHARS = 300;
const MAX_DESCRIPTION_CHARS = 1000;
const MAX_BYLINE_CHARS = 300;

/** How many of the article's first blocks may repeat its header. Older pages
 *  print the title, the subtitle and the byline above the text. */
const HEADER_BLOCKS_CHECKED = 4;

const SUBSTACK_POST_PATH = /^\/p\/([\w-]+)\/?$/;

export async function readPageForMinisite(url: string): Promise<MinisitePage> {
  if (!isWebUrl(url)) throw new PageReadError("This is not the address of a web page.");
  const post = await fetchSubstackPost(url);
  const page = post ? pageFromSubstackPost(post, url) : await readArticlePage(url);
  if (!page.plain_text.trim()) throw new PageReadError("We found no article text on this page.");
  return page;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Joins the converted blocks into reader text, leaving out leading blocks
 *  that only repeat the title, the description or the byline. */
function articleContent(blocks: string[], header: (string | null)[]): string {
  let skipped = 0;
  while (skipped < Math.min(blocks.length, HEADER_BLOCKS_CHECKED)) {
    const parsed = parseReaderText(blocks[skipped]);
    if (parsed.length !== 1 || withoutRepeatedHeader(parsed, header).length) break;
    skipped++;
  }
  return blocks.slice(skipped).join("\n\n");
}

function buildPage(fields: Omit<MinisitePage, "plain_text">): MinisitePage {
  return {
    ...fields,
    title: clip(fields.title.trim(), MAX_TITLE_CHARS),
    description: clip(fields.description.trim(), MAX_DESCRIPTION_CHARS),
    byline: fields.byline && clip(fields.byline, MAX_BYLINE_CHARS),
    plain_text: plainText(fields.content),
  };
}

function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ---------------------------------------------------------------------------
// Substack posts
// ---------------------------------------------------------------------------

interface SubstackPublication {
  id: number;
  name: string;
  subdomain: string;
}

/** The fields of Substack's /api/v1/posts/<slug> answer that a minisite uses. */
interface SubstackPost {
  title: string;
  subtitle: string | null;
  post_date: string | null;
  cover_image: string | null;
  canonical_url: string | null;
  body_html: string;
  publication_id: number;
  publishedBylines: { name: string; publicationUsers?: { publication?: SubstackPublication }[] }[];
}

function isSubstackPost(json: unknown): json is SubstackPost {
  const post = json as Partial<SubstackPost> | null;
  return typeof post?.body_html === "string" && typeof post.title === "string" && Array.isArray(post.publishedBylines);
}

/** Any address of the shape /p/<slug> may be a Substack post on a custom
 *  domain, so the post endpoint is asked first. A site that is not Substack
 *  answers with an error or with HTML, and the page is then read as any other. */
async function fetchSubstackPost(url: string): Promise<SubstackPost | null> {
  const { origin, pathname } = new URL(url);
  const slug = SUBSTACK_POST_PATH.exec(pathname)?.[1];
  if (!slug) return null;
  const answer = await fetchJson(`${origin}/api/v1/posts/${slug}`);
  return answer.ok && isSubstackPost(answer.json) ? answer.json : null;
}

function postPublication(post: SubstackPost): SubstackPublication | null {
  const publications = post.publishedBylines.flatMap((byline) => byline.publicationUsers ?? []).map((user) => user.publication);
  return publications.find((publication) => publication?.id === post.publication_id) ?? null;
}

/** Exported for the tests, which feed it a saved answer. */
export function pageFromSubstackPost(post: SubstackPost, url: string): MinisitePage {
  const publication = postPublication(post);
  const feed = publication ? canonicalSubstackFeed(`https://${publication.subdomain}.substack.com`) : substackFeedOfPage(url);
  const authors = joinNames(post.publishedBylines.map((byline) => byline.name));
  const byline = [authors, publication?.name].filter(Boolean).join(" · ") || null;
  return buildPage({
    title: post.title,
    description: post.subtitle ?? "",
    byline,
    published_at: isoDate(post.post_date),
    image_url: post.cover_image && isWebUrl(post.cover_image) ? post.cover_image : null,
    content: articleContent(htmlToReaderBlocks(post.body_html, post.canonical_url ?? url), [post.title, post.subtitle, byline]),
    creator_feed_url: feed?.feed_url ?? null,
  });
}

// ---------------------------------------------------------------------------
// Any other page
// ---------------------------------------------------------------------------

function metaContent(document: Document, names: string[]): string | null {
  for (const name of names) {
    const value = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute("content")?.trim();
    if (value) return value;
  }
  return null;
}

/** How much text besides its heading a wrapper may hold and still count as
 *  the heading's own wrapper. Wikipedia's holds an "edit" link. */
const MAX_HEADING_WRAPPER_EXTRA_CHARS = 20;

const textLength = (element: Element) => (element.textContent ?? "").trim().length;

/** Readability drops a heading whose class or id sounds like page chrome.
 *  Substack's section headings carry the class "header-anchor-post", so all
 *  four headings of the big-tent post were lost. It also drops a small wrapper
 *  that holds a link, heading and all, which is how Wikipedia's section
 *  headings were lost. So each heading loses its class and id, and replaces a
 *  wrapper that holds little besides it. */
function keepHeadings(document: Document): void {
  for (const heading of Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))) {
    heading.removeAttribute("class");
    heading.removeAttribute("id");
    let wrapper = heading.parentElement;
    while (wrapper?.localName === "div" && textLength(wrapper) - textLength(heading) <= MAX_HEADING_WRAPPER_EXTRA_CHARS) {
      wrapper.replaceWith(heading);
      wrapper = heading.parentElement;
    }
  }
}

function absoluteImage(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base).href;
    return isWebUrl(url) ? url : null;
  } catch {
    return null;
  }
}

/** The subdomain pattern of substackFeedInPageHtml would also match a
 *  "subdomain" key in some other site's data, so it is only asked on a page
 *  that carries Substack's preloads blob. */
const isSubstackPage = (html: string) => html.includes("window._preloads");

/** Exported for the tests, which feed it a saved page. */
export function pageFromArticleHtml(html: string, pageUrl: string): MinisitePage {
  const { document } = parseHTML(html);
  // Readability changes the document, so the page's own metadata is read first.
  const meta = {
    title: metaContent(document, ["og:title", "twitter:title"]),
    description: metaContent(document, ["og:description", "description", "twitter:description"]),
    image: metaContent(document, ["og:image", "twitter:image"]),
    author: metaContent(document, ["author", "article:author"]),
    siteName: metaContent(document, ["og:site_name"]),
    published: metaContent(document, ["article:published_time", "og:article:published_time", "date", "pubdate"]),
  };
  keepHeadings(document);
  const article = new Readability(document, { keepClasses: true }).parse();
  if (!article?.content) throw new PageReadError("We could not find an article on this page.");
  const title = meta.title ?? article.title ?? "";
  const description = meta.description ?? article.excerpt ?? "";
  const author = article.byline ?? meta.author;
  const byline = [author, meta.siteName ?? article.siteName].filter(Boolean).join(" · ") || null;
  return buildPage({
    title,
    description,
    byline,
    published_at: isoDate(meta.published ?? article.publishedTime),
    image_url: absoluteImage(meta.image, pageUrl),
    content: articleContent(htmlToReaderBlocks(article.content, pageUrl), [title, description, byline, author]),
    creator_feed_url: isSubstackPage(html) ? substackFeedInPageHtml(html)?.feed_url ?? null : null,
  });
}

async function readArticlePage(url: string): Promise<MinisitePage> {
  const fetched = await fetchWebPageHtml(url);
  if (!fetched.ok) {
    console.warn(`[minisite] could not fetch ${url}: ${fetched.reason}`);
    throw new PageReadError("We could not download this page. The site may block our server, or the page may need a login.");
  }
  return pageFromArticleHtml(fetched.html, fetched.fetchedUrl);
}
