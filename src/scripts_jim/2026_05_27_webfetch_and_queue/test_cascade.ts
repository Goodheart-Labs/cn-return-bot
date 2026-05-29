/**
 * Probe the production `describeMediaFromUrl` cascade against the social-media
 * URLs that ended up in iter-2's "login wall" bucket. Goal: distinguish between
 *   (a) cascade is broken for these URLs (then Crawl4AI is a real fallback win)
 *   (b) cascade works but iter-2 logging missed the error (then the integration
 *       is fine — we just need Crawl4AI as base for non-media URLs).
 */

import "dotenv/config";
import { describeMediaFromUrl } from "../../pipeline/media/mediaAnalysisGemini";
import { createTweetLog, withTweetLog } from "../../pipeline/utils/tweetLog";
import { withBotConfig, DEFAULT_CONFIG } from "../../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";

const URLS = [
  "https://www.reddit.com/r/GetNoted/comments/1rt9xyh/de_niro_and_mamdani/",
  "https://www.instagram.com/p/DUWHli8gTpK/",
  "https://www.facebook.com/NBCBayArea/videos/police-investigating-santana-row-attack-as-possible-hate-crime/2384729795331069/",
  "https://www.instagram.com/reel/DToWOookcl4/?hl=de",
  "https://www.facebook.com/photo.php?fbid=982113224486408&set=a.850196581011407&id=100080632194001",
  "https://www.facebook.com/pressoneph/posts/factcheck-a-facebook-reel-racking-up-over-400000-views-falsely-depicts-us-missil/1425155566297826/",
];

async function probeOne(url: string) {
  console.log(`\n=== ${url}`);
  const start = Date.now();
  try {
    const m = await describeMediaFromUrl(url, "test", "frames");
    const dur = ((Date.now() - start) / 1000).toFixed(1);
    const desc = m.analysis?.description?.description ?? "";
    const ocr = m.analysis?.description?.ocrText ?? "";
    const trans = m.analysis?.transcription ?? "";
    console.log(`  ✓ ${dur}s  kind=${m.kind}  desc=${desc.length}c  ocr=${ocr.length}c  trans=${trans.length}c`);
    console.log(`  title: ${(m.meta.title ?? "").slice(0, 100)}`);
    console.log(`  uploader: ${m.meta.uploader ?? "?"}`);
    if (desc) console.log(`  desc head: ${desc.slice(0, 200)}`);
    if (ocr) console.log(`  ocr head: ${ocr.slice(0, 120)}`);
  } catch (err: any) {
    const dur = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  ✗ ${dur}s  ${err?.message?.slice(0, 300) ?? err}`);
  }
}

async function main() {
  const cfg = { ...DEFAULT_CONFIG, botId: "cheap-bot", model: "deepseek/deepseek-v4-flash", verifier_model: "deepseek/deepseek-v4-flash", verifier_accepts_media_sources: true, web_search: "searxng" as const };
  await withBotConfig(cfg as any, async () => {
    await withCostTracker(async () => {
      await withTweetLog(createTweetLog(), async () => {
        for (const u of URLS) await probeOne(u);
      });
    });
  });
}

await main();
