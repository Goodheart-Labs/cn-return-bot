/**
 * Downloads the archived copy of the deleted post from the Wayback Machine and
 * writes site/public/article.json. That file holds two versions of the body.
 * `html` is a cleaned copy of the post's own markup, which the microsite
 * renders. `text` is the plain text with [[IMAGE:url]] markers, built exactly
 * the way the Substack source builds it, which the pipeline runner reads.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/fetchArticle.ts
 */

import { writeFileSync } from "fs";
import { parseHTML } from "linkedom";
import { htmlToText } from "../../everything/sources/substack";
import type { Article } from "./labRun";
import { ARTICLE_PATH } from "./runStore";

const POST_URL = "https://www.verysane.ai/p/ai-safety-is-mostly-a-sex-cult-in";
/** The newest snapshot that still shows the post. Later snapshots are
 *  redirects, because the author deleted it that evening. */
const SNAPSHOT_TIMESTAMP = "20260924194841";
/** The `id_` suffix asks the Wayback Machine for the page exactly as it was
 *  captured, without its own toolbar and without rewritten links. */
const SNAPSHOT_URL = `https://web.archive.org/web/${SNAPSHOT_TIMESTAMP}id_/${POST_URL}`;

/** Substack's interface furniture inside the body: the expand and share
 *  buttons on images, the heading link icons and the subscribe boxes. */
const FURNITURE_SELECTORS = [
  "script",
  "style",
  "svg",
  "button",
  ".image-link-expand",
  ".header-anchor-parent",
  ".subscription-widget-wrap",
  ".button-wrapper",
];

/** The attributes the microsite needs. Everything else, mostly Substack's
 *  generated class names, is dropped so the page's own styles apply. */
const KEPT_ATTRIBUTES = new Set(["href", "src", "alt", "id"]);

function cleanBody(body: Element): string {
  for (const selector of FURNITURE_SELECTORS) body.querySelectorAll(selector).forEach((el) => el.remove());
  for (const el of Array.from(body.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      if (!KEPT_ATTRIBUTES.has(attr.name)) el.removeAttribute(attr.name);
    }
  }
  return body.innerHTML;
}

async function main() {
  const response = await fetch(SNAPSHOT_URL);
  if (!response.ok) throw new Error(`Wayback answered ${response.status} for ${SNAPSHOT_URL}`);
  const { document } = parseHTML(await response.text());
  const body = document.querySelector(".body.markup");
  if (!body) throw new Error("The snapshot has no post body");
  const ldJson = JSON.parse(document.querySelector('script[type="application/ld+json"]')?.textContent ?? "{}");

  // The pipeline text is built first, from the untouched markup, because the
  // cleanup below removes the attributes the Substack conversion reads.
  const text = htmlToText(body.innerHTML, true);
  const article: Article = {
    url: POST_URL,
    snapshotUrl: `https://web.archive.org/web/${SNAPSHOT_TIMESTAMP}/${POST_URL}`,
    title: document.querySelector("h1.post-title")?.textContent?.trim() ?? "Untitled",
    subtitle: document.querySelector("h3.subtitle")?.textContent?.trim() ?? null,
    author: ldJson.author?.[0]?.name ?? ldJson.author?.name ?? null,
    publishedAt: ldJson.datePublished ?? null,
    html: cleanBody(body),
    text,
  };
  writeFileSync(ARTICLE_PATH, JSON.stringify(article, null, 2));
  const images = (text.match(/\[\[IMAGE:/g) ?? []).length;
  console.log(`"${article.title}" by ${article.author}: ${text.length} characters, ${images} images -> ${ARTICLE_PATH}`);
}

await main();
