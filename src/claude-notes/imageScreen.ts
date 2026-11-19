/* Screens every image of a post or a tweet before a Claude note writer starts
 * on it (GOO-815).
 *
 * Nathan's Claude account was banned once because tweets carried images of
 * child sexual abuse. The prompts forbid opening images, and imageGuard.ts
 * refuses every Read of one. This is one more layer in front: a job whose
 * input links to a flagged image gets no Claude at all.
 *
 * Each image is downloaded into memory, never onto the disk, and checked
 * twice:
 * 1. Arachnid Shield, the Canadian Centre for Child Protection's free API,
 *    compares the image with its list of fingerprints of known abuse images,
 *    including resized and edited copies. A known image is what gets an
 *    account banned, and the list almost never raises a false alarm.
 * 2. OpenAI's free moderation scores the image for sexual content. That model
 *    scores images only for sexual content in general; its category for
 *    minors works on text only (checked on 2026-11-19). So it refuses any
 *    image that looks sexual at all, with a low bar. A false alarm costs one
 *    tweet or one post.
 *
 * The image's bytes are sent, not its address: OpenAI cannot fetch some hosts
 * itself, and Arachnid fetches only from domains listed on our account. An
 * image that cannot be downloaded, or that OpenAI cannot read, is passed over,
 * because no Claude can see it either. Any other failure of either service
 * throws, so the job does not start. */

const ARACHNID_MEDIA_URL = "https://shield.projectarachnid.com/v1/media";
/** Arachnid's answer for an image on none of its lists. Anything else, a known
 *  abuse image, harmful material or Arachnid's own test image, stops the job. */
const ARACHNID_NO_MATCH = "no-known-match";
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

/** `reason` says which check stopped the job and what it saw, never the
 *  image's address. */
export type ImageScreen = { kind: "clear"; screened: number; passedOver: number } | { kind: "flagged"; reason: string };

type Image = { type: string; bytes: Buffer };

/** The image, or null when it cannot be had or is not an image. */
async function downloadImage(url: string): Promise<Image | null> {
  try {
    const response = await fetch(url, { headers: { Accept: ACCEPTED_IMAGE_TYPES }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!response.ok || !type.startsWith("image/")) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > MAX_IMAGE_BYTES ? null : { type, bytes };
  } catch {
    return null;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set, so the image screen cannot run`);
  return value;
}

/** Arachnid's classification of the image, such as "csam" or "no-known-match",
 *  with how it matched. */
async function arachnidVerdict(image: Image): Promise<{ classification: string; matchType: string | null }> {
  const login = `${requiredEnv("ARACHNID_SHIELD_USERNAME")}:${requiredEnv("ARACHNID_SHIELD_PASSWORD")}`;
  const response = await fetch(ARACHNID_MEDIA_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(login).toString("base64")}`, "Content-Type": image.type },
    body: new Uint8Array(image.bytes),
  });
  if (!response.ok) throw new Error(`Arachnid Shield answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = (await response.json()) as { classification: string; match_type: string | null };
  return { classification: body.classification, matchType: body.match_type };
}

/** OpenAI's "sexual" score of the image, or null when OpenAI cannot read its format. */
async function sexualScore(image: Image): Promise<number | null> {
  const response = await fetch(MODERATION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${requiredEnv("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODERATION_MODEL, input: [{ type: "image_url", image_url: { url: `data:${image.type};base64,${image.bytes.toString("base64")}` } }] }),
  });
  const body = (await response.json()) as { results?: { category_scores: Record<string, number> }[]; error?: { code?: string; message?: string } };
  if (body.error?.code === "invalid_image_format") return null;
  if (!response.ok || !body.results?.[0]) throw new Error(`OpenAI's moderation answered ${response.status}: ${body.error?.message ?? JSON.stringify(body).slice(0, 300)}`);
  return body.results[0].category_scores.sexual ?? 0;
}

/** Why the image stops the job, or null when it passes; undefined when no
 *  check could read it. */
async function screenImage(image: Image): Promise<string | null | undefined> {
  const arachnid = await arachnidVerdict(image);
  if (arachnid.classification !== ARACHNID_NO_MATCH) return `Arachnid Shield: ${arachnid.classification} (${arachnid.matchType ?? "unknown"} match)`;
  const score = await sexualScore(image);
  if (score === null) return undefined;
  return score >= SEXUAL_SCORE_LIMIT ? `OpenAI moderation: sexual score ${score.toFixed(2)}` : null;
}

/** Screens every image the text links to. Stops at the first flagged one. */
export async function screenImages(text: string): Promise<ImageScreen> {
  let screened = 0;
  let passedOver = 0;
  for (const url of imageLinksIn(text)) {
    const image = await downloadImage(url);
    const verdict = image === null ? undefined : await screenImage(image);
    if (verdict === undefined) {
      passedOver++;
      continue;
    }
    if (verdict !== null) return { kind: "flagged", reason: verdict };
    screened++;
  }
  return { kind: "clear", screened, passedOver };
}
