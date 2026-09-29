/**
 * GOO-202 probe. It runs on a GitHub runner, because the residential proxy's
 * address exists only as a repository secret there and on the services machine.
 *
 * Part 1 asks yt-dlp, without downloading, which file the old and the new
 * format selector pick for each video. The old one should fail with "Requested
 * format is not available", which confirms the cause.
 * Part 2 runs the source verifier's real media analysis on the same videos and
 * prints the size of what it downloaded and the start of Gemini's description.
 * Part 3 checks that a video which does not exist fails once, without retries.
 */

import "dotenv/config";
import { describeMediaFromUrl } from "../../pipeline/media/mediaAnalysisGemini";
import { execYtDlp } from "../../pipeline/media/ytDlpDownload";
import { createTweetLog, withTweetLog } from "../../pipeline/utils/tweetLog";
import { withBotConfig, DEFAULT_CONFIG } from "../../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";

const OLD_SELECTOR = "worst[height<=240]/worst";
const NEW_SELECTOR = "bv[height<=360]/wv/b[height<=360]/w";

/** Real sources whose low-quality download failed in production between
 *  2026-09-23 and 2026-09-27, all longer than 15 minutes. */
const LONG_VIDEOS = [
  "https://www.youtube.com/watch?v=402hOvSZ7tA",
  "https://www.youtube.com/watch?v=SOohnCFmPn4",
];

/** Failed in production with "This video is unavailable". */
const MISSING_VIDEO = "https://www.youtube.com/watch?v=d_M5U8C2D8Y";

async function showSelectedFormat(url: string, selector: string): Promise<void> {
  try {
    const picked = await execYtDlp(url, ["-f", selector, "--simulate", "--print", "%(format_id)s %(resolution)s vcodec=%(vcodec)s acodec=%(acodec)s size~%(filesize_approx)s duration=%(duration)s", url]);
    console.log(`  ${selector}  ->  ${picked.trim()}`);
  } catch (err: any) {
    console.log(`  ${selector}  ->  FAILED: ${err.message.split("\n").filter((l: string) => l.startsWith("ERROR")).join(" ")}`);
  }
}

async function describe(url: string): Promise<void> {
  const start = Date.now();
  try {
    const media = await describeMediaFromUrl(url, "probe", "frames");
    const seconds = ((Date.now() - start) / 1000).toFixed(1);
    const description = media.analysis.description?.description ?? "";
    console.log(`  OK in ${seconds}s, kind=${media.kind}, duration=${media.meta.duration}s, description ${description.length} chars, transcript ${media.analysis.transcription?.length ?? 0} chars`);
    console.log(`  description starts: ${description.slice(0, 300)}`);
  } catch (err: any) {
    console.log(`  FAILED in ${((Date.now() - start) / 1000).toFixed(1)}s: ${err.message.slice(0, 600)}`);
  }
}

async function main(): Promise<void> {
  console.log("== Part 1: which file each selector picks");
  for (const url of LONG_VIDEOS) {
    console.log(url);
    await showSelectedFormat(url, OLD_SELECTOR);
    await showSelectedFormat(url, NEW_SELECTOR);
  }

  console.log("\n== Part 2: the real media analysis");
  await withBotConfig(DEFAULT_CONFIG, () =>
    withCostTracker(() =>
      withTweetLog(createTweetLog(), async () => {
        for (const url of LONG_VIDEOS) {
          console.log(url);
          await describe(url);
        }
      }),
    ),
  );

  console.log("\n== Part 3: a missing video fails without retries (no [proxy] retry lines expected)");
  const start = Date.now();
  await execYtDlp(MISSING_VIDEO, ["-J", "--skip-download", MISSING_VIDEO]).catch((err: Error) =>
    console.log(`  failed after ${((Date.now() - start) / 1000).toFixed(1)}s: ${err.message.split("\n").filter((l) => l.startsWith("ERROR")).join(" ")}`),
  );
}

await main();
