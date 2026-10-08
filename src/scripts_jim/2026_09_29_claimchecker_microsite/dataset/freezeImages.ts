/**
 * Describes, once, every image in the posts of the datapoints and saves the
 * descriptions in images.json. The extractor reads these descriptions instead of
 * the images, so freezing them keeps every eval run on the same text. It costs
 * one Gemini call per image, and a run of this script skips images already saved.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/freezeImages.ts
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { describeArticleImages } from "../../../everything/pipeline/extractClaims";
import { IMAGE_MARKER_RE } from "../../../everything/sources/substack";
import type { GeminiMediaDescription } from "../../../pipeline/media/mediaAnalysisGemini";
import { LAB_DIR } from "../runStore";
import { DATAPOINTS } from "./datapoints";
import { withCost } from "./judges";
import { loadItemTexts } from "./itemTexts";

export const IMAGES_PATH = join(LAB_DIR, "dataset", "images.json");

export function loadFrozenDescriptions(): Map<string, GeminiMediaDescription> {
  if (!existsSync(IMAGES_PATH)) return new Map();
  return new Map(Object.entries(JSON.parse(readFileSync(IMAGES_PATH, "utf8")) as Record<string, GeminiMediaDescription>));
}

const imageUrlsOf = (text: string) => [...new Set([...text.matchAll(new RegExp(IMAGE_MARKER_RE.source, "g"))].map((m) => m[1]!))];

if (import.meta.main) {
  // The local OPENROUTER_API_KEY is dead. The testing key works.
  if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  const frozen = loadFrozenDescriptions();
  const texts = await loadItemTexts(DATAPOINTS.map((d) => d.itemId));
  let totalCost = 0;
  for (const [itemId, text] of texts) {
    const missing = imageUrlsOf(text).filter((url) => !frozen.has(url));
    if (missing.length === 0) continue;
    const { value, costUsd } = await withCost(() => describeArticleImages(missing.map((url) => `[[IMAGE:${url}]]`).join("\n")));
    totalCost += costUsd;
    // A failed description comes back empty. It is not saved, so a rerun tries it again.
    const failed = [...value].filter(([, d]) => !d.description && !d.ocrText).length;
    for (const [url, description] of value) if (description.description || description.ocrText) frozen.set(url, description);
    console.log(`${itemId}: described ${missing.length - failed} images, ${failed} failed, $${costUsd.toFixed(3)}`);
    writeFileSync(IMAGES_PATH, JSON.stringify(Object.fromEntries(frozen), null, 1));
  }
  console.log(`${frozen.size} images saved in ${IMAGES_PATH}, $${totalCost.toFixed(3)} this run`);
}
