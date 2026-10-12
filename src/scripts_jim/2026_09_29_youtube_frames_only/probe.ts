/**
 * GOO-202 probe. It runs on a GitHub runner, because the residential proxy's
 * address exists only as a repository secret there and on the services machine.
 *
 * It runs the source verifier's real media description on one case per path:
 * a short and a 9-minute YouTube video (downloaded without sound, captions as
 * the transcript), two YouTube videos over 10 minutes (captions only, one of
 * them in Hindi, which tests the fallback to the video's own language), a
 * YouTube video that no longer exists, and three videos from other sites: a
 * 1-minute clip (downloaded with its sound for Whisper), a 6-minute film
 * (pictures only, no transcript) and a 20-minute film (details only).
 *
 * The first run of this probe, on the earlier version of the fix, also showed
 * that the old format rule fails on YouTube with "Requested format is not
 * available" and that a missing video is no longer retried.
 */

import "dotenv/config";
import { describeMediaFromUrl, type MediaSourceDescription } from "../../pipeline/media/describeMediaSource";
import { createTweetLog, withTweetLog } from "../../pipeline/utils/tweetLog";
import { withBotConfig, DEFAULT_CONFIG } from "../../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";

const CASES = [
  "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  "https://www.youtube.com/watch?v=g4qjH2ONjDY",
  "https://www.youtube.com/watch?v=JvrpiccxCEs",
  "https://www.youtube.com/watch?v=402hOvSZ7tA",
  "https://www.youtube.com/watch?v=d_M5U8C2D8Y",
  "https://commons.wikimedia.org/wiki/File:Folgers.ogv",
  "https://archive.org/details/Popeye_forPresident",
  "https://archive.org/details/CC_1916_09_04_TheCount",
];

function summarize(media: MediaSourceDescription): string {
  const head = `kind=${media.kind}, title="${media.details.title?.slice(0, 60)}", published=${media.details.published}`;
  if (media.kind === "video_too_long") return `${head}\n  transcript ${media.transcript?.length ?? 0} chars: ${media.transcript?.slice(0, 200)}`;
  const { description, transcription } = media.analysis;
  return `${head}\n  description ${description.description.length} chars: ${description.description.slice(0, 200)}\n  transcript ${transcription?.length ?? 0} chars: ${transcription?.slice(0, 200)}`;
}

async function probe(url: string): Promise<void> {
  console.log(`\n=== ${url}`);
  const start = Date.now();
  try {
    const media = await describeMediaFromUrl(url, "probe", "frames");
    console.log(`  OK in ${((Date.now() - start) / 1000).toFixed(1)}s, ${summarize(media)}`);
  } catch (err: any) {
    console.log(`  FAILED in ${((Date.now() - start) / 1000).toFixed(1)}s: ${err.message.slice(0, 600)}`);
  }
}

await withBotConfig(DEFAULT_CONFIG, () =>
  withCostTracker(() =>
    withTweetLog(createTweetLog(), async () => {
      for (const url of CASES) await probe(url);
    }),
  ),
);
