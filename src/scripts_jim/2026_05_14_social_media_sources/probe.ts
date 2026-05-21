/**
 * Probe describeMediaFromUrl against a few real cited URLs pulled from the
 * sonnet-search simple-bot runs. Prints the cascade outcome (yt-dlp /
 * gallery-dl / failure), key metadata, the Gemini analysis snippets, and
 * the transcript source (auto-subs vs. Whisper).
 */

import "dotenv/config";

import { describeMediaFromUrl } from "../../pipeline/media/mediaAnalysisGemini";
import { DEFAULT_CONFIG, withBotConfig } from "../../pipeline/ab-testing/botConfig";

const URLS = [
  "https://www.youtube.com/watch?v=galyuH1xMC4",
  "https://www.tiktok.com/discover/gorilla-lift-weights",
  "https://www.youtube.com/watch?v=cCTH8R6RD74",
];

function trunc(s: string | undefined, n: number): string {
  if (!s) return "(none)";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

async function probeOne(url: string, idx: number): Promise<void> {
  console.log(`\n=== [${idx + 1}/${URLS.length}] ${url} ===`);
  const startMs = Date.now();
  try {
    const result = await describeMediaFromUrl(url, `probe.${idx}`);
    const elapsedS = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`  ✓ kind:        ${result.kind}`);
    console.log(`    title:       ${trunc(result.meta.title, 120)}`);
    console.log(`    uploader:    ${trunc(result.meta.uploader, 60)}`);
    console.log(`    duration:    ${result.meta.duration ? `${result.meta.duration}s (${Math.round(result.meta.duration / 60)} min)` : "(none)"}`);
    console.log(`    summary:     ${trunc(result.analysis.description.description, 240)}`);
    console.log(`    ocr/text:    ${trunc(result.analysis.description.ocrText, 200)}`);
    const tr = result.analysis.transcription;
    if (tr) {
      console.log(`    transcript:  (${tr.length} chars) ${trunc(tr, 200)}`);
    } else {
      console.log(`    transcript:  (none)`);
    }
    console.log(`    elapsed:     ${elapsedS}s`);
  } catch (err: any) {
    const elapsedS = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`  ✗ FAILED in ${elapsedS}s`);
    console.log(`    ${err?.message ?? err}`);
  }
}

async function main(): Promise<void> {
  await withBotConfig(
    { ...DEFAULT_CONFIG, botId: "probe" },
    async () => {
      for (let i = 0; i < URLS.length; i++) {
        await probeOne(URLS[i]!, i);
      }
    },
  );
}

main().catch((err) => {
  console.error("probe fatal:", err);
  process.exit(1);
});
