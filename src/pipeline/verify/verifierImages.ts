/**
 * Verifier image collection.
 *
 * Gathers the images the source verifier should *see* — the post's media, the
 * quoted post's, and images found in each cited source — and lays them out as
 * multimodal content parts in reading order: a heading, then the images it
 * names, then the next heading. A model reads the parts in sequence, so the
 * labels are enough to tell whose picture is whose; no manifest, no numbering.
 *
 * This is what lets the verifier catch out-of-context media: a post image and a
 * cited source's image may show a *similar but different* event/place/time.
 */

import { FETCH_UAS } from "../tool-calling/tools";
import type { ContentPart } from "../utils/jsonLlmCall";
import type { GeminiMediaItem, GeminiMediaResult } from "../media/mediaAnalysisGemini";

/** One labeled run of images: the heading, then the images it names. */
export interface VerifierImageGroup {
  label: string;
  /** https URLs (post/quoted CDN, source page images) or base64 data: URLs. */
  urls: string[];
}

/** Cap total images sent to the verifier — bounds vision token cost per run. */
const MAX_VERIFIER_IMAGES = 12;
/** Cap images pulled from a single web source — avoids ad/gallery noise. */
const MAX_IMAGES_PER_SOURCE = 3;
const IMAGE_FETCH_TIMEOUT_MS = 8_000;
/** Skip anything bigger — vision models downscale anyway, and a huge base64
 *  body costs upload time for no extra detail. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)/g;
// Filename hints for chrome we never want as evidence (logos, icons, spacers).
const NON_CONTENT_IMAGE_HINT = /(sprite|logo|icon|favicon|avatar|spacer|pixel|1x1|tracking|badge|button)/i;

/** Verifier-model ids that accept image input. Images are silently skipped for
 *  any other model (e.g. text-only deepseek), so the flag is a no-op there. */
export function verifierModelSupportsImages(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes("gemini") || m.includes("claude");
}

/** Tweet + quoted-tweet images already analyzed in the bot input. Videos are
 *  out of scope (we only have a text description for them). */
export function collectPostImageGroups(mediaResult?: GeminiMediaResult): VerifierImageGroup[] {
  if (!mediaResult) return [];
  const imageUrls = (items: GeminiMediaItem[]) =>
    items.filter((m) => m.type === "image" && !!m.url).map((m) => m.url);
  return withImages([
    { label: "Post images", urls: imageUrls(mediaResult.tweetMedia) },
    { label: "Quoted post images", urls: imageUrls(mediaResult.quotedTweetMedia) },
  ]);
}

/** Heading for a cited source's own images — named by URL so the model can tie
 *  them to that source's text section. */
export function sourceImageGroup(url: string, urls: string[]): VerifierImageGroup {
  return { label: `Images from cited source ${url}`, urls };
}

/** Pull main-content image URLs out of a fetched source's markdown, resolved to
 *  absolute https URLs and capped per source. */
export function extractSourceImageUrls(markdown: string, sourceUrl: string): string[] {
  const urls: string[] = [];
  for (const match of markdown.matchAll(MARKDOWN_IMAGE_RE)) {
    const abs = toContentImageUrl(match[1], sourceUrl);
    if (!abs || urls.includes(abs)) continue;
    urls.push(abs);
    if (urls.length >= MAX_IMAGES_PER_SOURCE) break;
  }
  return urls;
}

function toContentImageUrl(raw: string | undefined, baseUrl: string): string | null {
  if (!raw) return null;
  let resolved: URL;
  try {
    resolved = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
  if (/\.svg($|\?)/i.test(resolved.pathname)) return null;
  if (NON_CONTENT_IMAGE_HINT.test(resolved.pathname)) return null;
  return resolved.href;
}

function withImages(groups: VerifierImageGroup[]): VerifierImageGroup[] {
  return groups.filter((g) => g.urls.length > 0);
}

/**
 * Download an image and inline it as a base64 data URL, or null if it can't be
 * had. We send bytes rather than URLs because the provider fetches a remote URL
 * itself — with its own UA, from its own IP — and one hotlink-protected image
 * fails the ENTIRE completion with a 400. Fetching here means a blocked image is
 * simply one image the verifier doesn't see. Data URLs (the yt-dlp cascade's
 * source images) pass straight through.
 */
async function toInlineImage(url: string): Promise<string | null> {
  if (url.startsWith("data:")) return url;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": FETCH_UAS.desktop, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const mimeType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim();
    // SVG and other vector/markup types aren't reliable vision inputs.
    if (!mimeType.startsWith("image/") || mimeType === "image/svg+xml") return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * The verifier's user-message content: the text, then each group's heading
 * followed by its images. Total images are capped, and a group left empty (by
 * the cap, or because none of its images could be downloaded) is dropped rather
 * than left as a heading promising pictures that aren't there. Returns the plain
 * string when nothing is attached, so a text-only call is identical to one made
 * with images off. `attached` carries the ORIGINAL urls, not the inlined bytes,
 * so it is worth logging.
 */
export async function buildVerifierContent(text: string, groups: VerifierImageGroup[]): Promise<{
  content: string | ContentPart[];
  attached: VerifierImageGroup[];
}> {
  const attached: VerifierImageGroup[] = [];
  const parts: ContentPart[] = [{ type: "text", text }];
  let budget = MAX_VERIFIER_IMAGES;

  for (const group of withImages(groups)) {
    if (budget === 0) break;
    const urls = group.urls.slice(0, budget);
    const inlined = await Promise.all(urls.map(toInlineImage));
    const usable = urls.filter((_, i) => inlined[i] !== null);
    if (usable.length === 0) continue;

    budget -= usable.length;
    attached.push({ label: group.label, urls: usable });
    parts.push({ type: "text", text: `## ${group.label}` });
    for (const image of inlined) {
      if (image) parts.push({ type: "image_url", image_url: { url: image } });
    }
  }

  return attached.length === 0 ? { content: text, attached } : { content: parts, attached };
}
