/* Screens every image of a post or a tweet before a Claude note writer starts
 * on it (GOO-815).
 *
 * Nathan's Claude account was banned once because tweets carried images of
 * child sexual abuse. The prompts forbid opening images, and imageGuard.ts
 * refuses every Read of one. This is one more layer in front: a job whose
 * input links to a flagged image gets no Claude at all.
 *
 * Each image is downloaded into memory, never onto the disk, and scored by
 * OpenAI's moderation endpoint, which is free with any OpenAI API key. That
 * model scores images only for sexual content in general. Its category for
 * minors works on text only (checked on 2026-11-19). So the screen refuses
 * any image that looks sexual at all, with a low bar. A false alarm costs one
 * tweet or one post.
 *
 * The image's bytes are sent, not its address, because OpenAI cannot fetch
 * some hosts itself, for example Wikimedia's. An image that cannot be
 * downloaded, or that OpenAI cannot read, is passed over: no Claude can see
 * it either. Any other failure of OpenAI throws, so the job does not start. */

const MODERATION_URL = "https://api.openai.com/v1/moderations";
const MODERATION_MODEL = "omni-moderation-latest";
/** The score of OpenAI's "sexual" category from which an image stops the job.
 *  OpenAI's own flag sits higher. Jim asked for a filter that does an okay job,
 *  and a missed image costs far more than a skipped job. */
const SEXUAL_SCORE_LIMIT = 0.2;
/** OpenAI accepts images up to 20 MB. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
/** The formats OpenAI's moderation reads. Hosts such as Substack's CDN pick a
 *  format by this header, and would otherwise send AVIF. */
const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif";

/** An image file's address: a usual image extension, or a host that serves
 *  images without one. */
const IMAGE_LINK = /https?:\/\/[^\s)<>"'\]]+?\.(?:png|jpe?g|gif|webp|avif|heic|bmp)(?:\?[^\s)<>"'\]]*)?|https?:\/\/(?:pbs\.twimg\.com\/media|substackcdn\.com\/image|substack-post-media\.s3\.amazonaws\.com)\/[^\s)<>"'\]]+/gi;

export function imageLinksIn(text: string): string[] {
  return [...new Set(text.match(IMAGE_LINK) ?? [])];
}

export type ImageScreen = { kind: "clear"; screened: number; passedOver: number } | { kind: "flagged"; sexualScore: number };

/** The image's bytes as a data URL, or null when it cannot be had or is not
 *  an image. */
async function downloadImage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: { Accept: ACCEPTED_IMAGE_TYPES }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!response.ok || !type.startsWith("image/")) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/** OpenAI's "sexual" score of one image, or null when OpenAI cannot read its format. */
async function sexualScore(dataUrl: string): Promise<number | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set, so the image screen cannot run");
  const response = await fetch(MODERATION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODERATION_MODEL, input: [{ type: "image_url", image_url: { url: dataUrl } }] }),
  });
  const body = (await response.json()) as { results?: { category_scores: Record<string, number> }[]; error?: { code?: string; message?: string } };
  if (body.error?.code === "invalid_image_format") return null;
  if (!response.ok || !body.results?.[0]) throw new Error(`OpenAI's moderation answered ${response.status}: ${body.error?.message ?? JSON.stringify(body).slice(0, 300)}`);
  return body.results[0].category_scores.sexual ?? 0;
}

/** Screens every image the text links to. Stops at the first flagged one. */
export async function screenImages(text: string): Promise<ImageScreen> {
  let screened = 0;
  let passedOver = 0;
  for (const url of imageLinksIn(text)) {
    const image = await downloadImage(url);
    const score = image === null ? null : await sexualScore(image);
    if (score === null) {
      passedOver++;
      continue;
    }
    if (score >= SEXUAL_SCORE_LIMIT) return { kind: "flagged", sexualScore: score };
    screened++;
  }
  return { kind: "clear", screened, passedOver };
}
