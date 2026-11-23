/* Screens every image of a post or a tweet before a Claude note writer starts
 * on it (GOO-815).
 *
 * Nathan's Claude account was banned once because tweets carried images of
 * child sexual abuse. The prompts forbid opening images, and imageGuard.ts
 * refuses every Read of one. This is one more layer in front: a job whose
 * input links to a flagged image gets no Claude at all.
 *
 * Each image is downloaded into memory, never onto the disk, and sent to
 * Arachnid Shield, the Canadian Centre for Child Protection's free API. It
 * compares the image with its list of fingerprints of known abuse images,
 * including resized and edited copies. A known image is what gets an account
 * banned, and the list almost never raises a false alarm.
 *
 * Until GOO-852 (2026-11-23) OpenAI's moderation also scored every image for
 * sexual content, and a low score stopped the job. Jim removed that check.
 * For X tweets, the X run now drops every tweet that X marked as possibly
 * sensitive (isPossiblySensitive in src/api/fetchEligiblePosts.ts).
 *
 * The image's bytes are sent, not its address, because Arachnid fetches only
 * from domains listed on our account. An image that cannot be downloaded is
 * passed over, because no Claude can see it either. Any failure of Arachnid
 * throws, so the job does not start.
 *
 * The screen runs only on a host that has the Arachnid Shield login. Jim
 * decided on 2026-11-19 (GOO-822) that a host without it, such as Nathan's hq,
 * must keep working when it pulls main. Such a host starts its Claudes without
 * the screen. It still has the two older layers: the prompt rule against
 * opening images and the hook that refuses every Read of one. A host that has
 * the login but lacks the password throws on its first image, because it was
 * clearly meant to screen. */

const ARACHNID_MEDIA_URL = "https://shield.projectarachnid.com/v1/media";
/** Arachnid's answer for an image on none of its lists. Anything else, a known
 *  abuse image, harmful material or Arachnid's own test image, stops the job. */
const ARACHNID_NO_MATCH = "no-known-match";
/** A cap on what one image download may hold in memory. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
/** Common image formats. Hosts such as Substack's CDN pick a format by this
 *  header, and would otherwise send AVIF. */
const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif";

/** An image file's address: a usual image extension, or a host that serves
 *  images without one. */
const IMAGE_LINK = /https?:\/\/[^\s)<>"'\]]+?\.(?:png|jpe?g|gif|webp|avif|heic|bmp)(?:\?[^\s)<>"'\]]*)?|https?:\/\/(?:pbs\.twimg\.com\/media|substackcdn\.com\/image|substack-post-media\.s3\.amazonaws\.com)\/[^\s)<>"'\]]+/gi;

export function imageLinksIn(text: string): string[] {
  return [...new Set(text.match(IMAGE_LINK) ?? [])];
}

/** Whether this host screens images: it has the Arachnid Shield login. */
export const imageScreenOn = () => Boolean(process.env.ARACHNID_SHIELD_USERNAME);

/** `reason` says what Arachnid matched, never the image's address. "off" means the host has no Arachnid Shield login. */
export type ImageScreen = { kind: "clear"; screened: number; passedOver: number } | { kind: "flagged"; reason: string } | { kind: "off" };

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

/** Why the image stops the job, or null when it passes. */
async function screenImage(image: Image): Promise<string | null> {
  const arachnid = await arachnidVerdict(image);
  return arachnid.classification === ARACHNID_NO_MATCH ? null : `Arachnid Shield: ${arachnid.classification} (${arachnid.matchType ?? "unknown"} match)`;
}

/** Screens every image the text links to. Stops at the first flagged one. */
export async function screenImages(text: string): Promise<ImageScreen> {
  if (!imageScreenOn()) return { kind: "off" };
  let screened = 0;
  let passedOver = 0;
  for (const url of imageLinksIn(text)) {
    const image = await downloadImage(url);
    if (image === null) {
      passedOver++;
      continue;
    }
    const verdict = await screenImage(image);
    if (verdict !== null) return { kind: "flagged", reason: verdict };
    screened++;
  }
  return { kind: "clear", screened, passedOver };
}
