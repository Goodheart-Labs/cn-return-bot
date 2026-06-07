/**
 * Verifier image collection.
 *
 * Gathers the images the source verifier should *see* (post media, quoted-tweet
 * media, and images found in the cited sources), builds the OpenRouter
 * `image_url` content parts, and a text manifest mapping each image index to its
 * origin so the model knows which image belongs to the post vs. each source.
 *
 * This is what lets the verifier catch out-of-context media: a post image and a
 * cited source's image may show a *similar but different* event/place/time.
 */

import type { ContentPart } from "../utils/jsonLlmCall";
import type { GeminiMediaResult } from "../media/mediaAnalysisGemini";

export interface VerifierImage {
  /** https URL (post/quoted CDN, source page image) or a base64 data: URL. */
  url: string;
  /** Human-readable origin shown in the manifest, e.g. "main post media". */
  origin: string;
}

/** Cap total images sent to the verifier — bounds vision token cost per run. */
const MAX_VERIFIER_IMAGES = 12;
/** Cap images pulled from a single web source — avoids ad/gallery noise. */
const MAX_IMAGES_PER_SOURCE = 3;

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
export function collectPostImages(mediaResult?: GeminiMediaResult): VerifierImage[] {
  if (!mediaResult) return [];
  const fromItems = (items: typeof mediaResult.tweetMedia, origin: string): VerifierImage[] =>
    items.filter((m) => m.type === "image" && !!m.url).map((m) => ({ url: m.url, origin }));
  return [
    ...fromItems(mediaResult.tweetMedia, "main post media"),
    ...fromItems(mediaResult.quotedTweetMedia, "quoted post media"),
  ];
}

/** Pull main-content image URLs out of a fetched source's markdown, resolved to
 *  absolute https URLs and capped per source. */
export function extractSourceImages(markdown: string, sourceUrl: string): VerifierImage[] {
  const seen = new Set<string>();
  const images: VerifierImage[] = [];
  for (const match of markdown.matchAll(MARKDOWN_IMAGE_RE)) {
    const abs = toContentImageUrl(match[1], sourceUrl);
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    images.push({ url: abs, origin: `cited source ${sourceUrl}` });
    if (images.length >= MAX_IMAGES_PER_SOURCE) break;
  }
  return images;
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

/** Build the manifest text + image content parts from the (total-)capped image
 *  set. Order is preserved so the manifest's "Image N" lines line up with the
 *  parts the model receives. Returns the capped `images` as the single source of
 *  truth for callers that also log what was sent. */
export function buildImagePayload(images: VerifierImage[]): {
  manifest: string;
  parts: ContentPart[];
  images: VerifierImage[];
} {
  const capped = images.slice(0, MAX_VERIFIER_IMAGES);
  const lines = capped.map((img, i) => `Image ${i + 1}: ${img.origin}`);
  const manifest = ["## Attached images", ...lines].join("\n");
  const parts: ContentPart[] = capped.map((img) => ({
    type: "image_url",
    image_url: { url: img.url },
  }));
  return { manifest, parts, images: capped };
}
