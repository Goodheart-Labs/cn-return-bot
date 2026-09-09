import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import { execYtDlp, execYtDlpAsync, fetchTimedTranscript, listOriginalSubtitleLanguages, type SubtitleCue } from "../../pipeline/media/ytDlpDownload";
import type { FetchedContent } from "../types";

export function ensureYtDlp(): void {
  try {
    execSync("yt-dlp --version", { stdio: "pipe" });
  } catch {
    console.error("yt-dlp is not installed. Install with: brew install yt-dlp");
    process.exit(1);
  }
}

/** yt-dlp reports upload_date as YYYYMMDD. This turns it into the ISO form
 *  YYYY-MM-DD. It returns undefined when the value is missing or malformed. */
function parseUploadDate(raw: string): string | undefined {
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/** yt-dlp prints "NA" for a field it has no value for. */
const ytDlpField = (raw: string): string | undefined => (raw && raw !== "NA" ? raw : undefined);

/** Fetch the id, the title, the channel name and the upload date by printing
 *  just those fields. We do not ask for the full -J metadata here. For a
 *  YouTube video that JSON is large enough to overflow the output buffer of
 *  the yt-dlp child process. */
export function fetchVideoMeta(url: string): { id: string; title: string; channel?: string; uploadDate?: string } {
  // We print the title last because a title can span several lines. Everything
  // after the channel therefore belongs to the title, and the earlier fields
  // stay readable.
  // A flagged proxy IP gets a degraded player response whose format list is
  // empty, and format selection then aborts the whole call with "Requested
  // format is not available" even though the metadata fields were served.
  // Printing metadata needs no formats, so we tell yt-dlp to ignore that.
  const out = execYtDlp(url, ["--skip-download", "--ignore-no-formats-error", "--no-warnings", "--print", "%(upload_date)s", "--print", "%(id)s", "--print", "%(channel)s", "--print", "%(title)s", url]);
  const [uploadDate = "", id = "", channel = "", ...titleParts] = out.trim().split("\n");
  return { id, title: titleParts.join(" ").trim(), channel: ytDlpField(channel), uploadDate: parseUploadDate(uploadDate) };
}

export interface ChannelVideo {
  videoId: string;
  url: string;
  title: string;
  durationSeconds: number | null;
}

export interface ChannelListing {
  /** The channel's display name. */
  channelName?: string;
  videos: ChannelVideo[];
}

/** List the channel's name and the latest videos on its /videos tab with a
 *  single flat-playlist yt-dlp call. The newest video comes first and Shorts
 *  are left out, because that tab does not list them. The duration is null for
 *  a premiere and for a video that has not aired yet. The listing carries no
 *  upload dates; fetchUploadDates supplies those in bulk. */
export function fetchChannelVideos(channelUrl: string, limit: number): ChannelListing {
  // The per-video lines print first, one per video. The playlist-level print
  // runs once after them, so the channel name is always the last line.
  const out = execYtDlp(channelUrl, [
    "--flat-playlist",
    "--no-warnings",
    "--playlist-items",
    `1:${limit}`,
    "--print",
    "%(id)s\t%(duration)s\t%(title)s",
    "--print",
    "playlist:%(channel)s",
    `${channelUrl.replace(/\/$/, "")}/videos`,
  ]);
  return parseChannelListing(out, channelUrl);
}

/** Turns the listing's printed lines into videos. Exported for the tests. */
export function parseChannelListing(out: string, channelUrl: string): ChannelListing {
  const lines = out.trim().split("\n").filter(Boolean);
  // A video line always contains tabs and a channel name never does, so a
  // tabbed last line means the playlist print did not run.
  const channelName = lines.at(-1)?.includes("\t") ? undefined : ytDlpField(lines.pop() ?? "");
  const videos = lines.map((line) => {
    const [videoId = "", duration = "", ...titleParts] = line.split("\t");
    return {
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: titleParts.join(" "),
      durationSeconds: /^\d/.test(duration) ? Number.parseFloat(duration) : null,
    };
  });
  // A channel's videos tab is never empty, so an empty listing means yt-dlp
  // failed silently. An outdated yt-dlp does exactly this: it exits with code
  // zero and prints nothing. Fail loudly instead of treating it as "no videos".
  if (videos.length === 0) {
    throw new Error(`yt-dlp listed zero videos for ${channelUrl} — it is probably outdated or blocked`);
  }
  return { channelName, videos };
}


/** How many videos one yt-dlp process is asked to date. One process per
 *  video paid a second of interpreter startup each time; ten per process
 *  shares it and the HTTP session. */
const DATE_BATCH_SIZE = 10;
/** How many of those processes run at once. Enough to take most of the wall
 *  time off a walk with a few hundred candidates, few enough to look like a
 *  person to the proxy's residential exits. */
const DATE_CONCURRENCY = 5;

/** The exact upload day, YYYY-MM-DD, of each video, keyed by video id. The
 *  walk needs one per candidate for its recency rank, and the flat listing
 *  carries none. Before this the walk made one yt-dlp call per video, one
 *  after another, and those calls were most of its running time; this asks
 *  for the same field in batches, several at once.
 *
 *  Skipping the watch page makes yt-dlp read the date from the player API
 *  alone, which is the same value and far fewer bytes through a proxy paid for
 *  by the gigabyte. A video yt-dlp cannot read is left out of the map rather
 *  than failing the batch; the caller treats a missing date as unknown. */
export async function fetchUploadDates(videoUrls: string[]): Promise<Map<string, string>> {
  const dates = new Map<string, string>();
  const batches: string[][] = [];
  for (let i = 0; i < videoUrls.length; i += DATE_BATCH_SIZE) batches.push(videoUrls.slice(i, i + DATE_BATCH_SIZE));

  const runBatch = async (batch: string[]) => {
    try {
      const out = await execYtDlpAsync(batch[0]!, [
        "--skip-download",
        "--ignore-no-formats-error",
        "--ignore-errors",
        "--no-warnings",
        "--extractor-args",
        "youtube:player_skip=webpage,configs,js",
        "--print",
        "%(id)s\t%(upload_date)s",
        ...batch,
      ]);
      for (const line of out.split("\n")) {
        const [id, raw] = line.split("\t");
        const day = raw ? parseUploadDate(raw) : undefined;
        if (id && day) dates.set(id, day);
      }
    } catch (err: any) {
      console.warn(`  upload dates failed for a batch of ${batch.length} videos: ${err?.message?.split("\n")[0]}`);
    }
  };

  // A fixed number of workers each pull the next batch until none is left.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(DATE_CONCURRENCY, batches.length) }, async () => {
      while (next < batches.length) await runBatch(batches[next++]!);
    }),
  );
  return dates;
}

/** How deep into a channel's /videos tab the top-videos scan looks. Our
 *  largest followed channels have around 2000 videos, so this covers a whole
 *  channel; on an even larger one the scan simply misses the tail, which at
 *  that depth holds no all-time hits. */
const TOP_VIDEOS_SCAN_LIMIT = 3000;

export interface ChannelTopVideo {
  videoId: string;
  url: string;
  title: string;
  viewCount: number;
}

/** The channel's n most viewed videos, most viewed first, from one
 *  flat-playlist call over the whole /videos tab. That tab leaves Shorts out.
 *  A premiere that has not aired yet has no view count and is dropped. */
export function fetchChannelTopVideos(channelUrl: string, n: number): ChannelTopVideo[] {
  const out = execYtDlp(channelUrl, [
    "--flat-playlist",
    "--no-warnings",
    "--playlist-items",
    `1:${TOP_VIDEOS_SCAN_LIMIT}`,
    "--print",
    "%(view_count)s\t%(id)s\t%(title)s",
    `${channelUrl.replace(/\/$/, "")}/videos`,
  ]);
  const videos = out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [views = "", videoId = "", ...titleParts] = line.split("\t");
      return {
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: titleParts.join(" "),
        viewCount: /^\d/.test(views) ? Number.parseInt(views, 10) : NaN,
      };
    })
    .filter((v) => Number.isFinite(v.viewCount));
  if (videos.length === 0) {
    throw new Error(`yt-dlp listed zero viewable videos for ${channelUrl} — it is probably outdated or blocked`);
  }
  return videos.sort((a, b) => b.viewCount - a.viewCount).slice(0, n);
}

/** English is asked for first, because everything downstream of the transcript
 *  is written in English. The `.*` picks up the regional spellings (`en-US`) and
 *  the marker YouTube puts on an original English track (`en-orig`). */
const PREFERRED_TRANSCRIPT_LANG = "en.*";

/** How many of the video's own tracks are fetched when English is missing. They
 *  go in one call and we keep the first that parses. A video rarely has more
 *  than one original track, and every extra one is paid proxy traffic. */
const MAX_FALLBACK_LANGUAGES = 3;

/** Fetch the video's timestamped cues. The temporary directory is always
 *  removed afterwards. This throws when the video has no transcript.
 *
 *  A video that is not in English has no English track at all, and its machine
 *  translations are throttled hard enough by YouTube to be unusable, so we fall
 *  back to the language the video is actually in. The claims then come out in
 *  that language, which is the right thing anyway: the note is read by the
 *  people watching the video. Listing the languages costs an extra call, so it
 *  only happens once English has come back empty. */
function fetchCues(url: string): SubtitleCue[] {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "cn-yt-subs-"));
  try {
    const english = fetchTimedTranscript(url, dir, PREFERRED_TRANSCRIPT_LANG);
    if (english?.length) return english;

    const languages = listOriginalSubtitleLanguages(url).slice(0, MAX_FALLBACK_LANGUAGES);
    const own = languages.length ? fetchTimedTranscript(url, dir, languages.join(",")) : null;
    if (own?.length) return own;
    throw new Error(`No transcript available for ${url}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function fetchYoutubeContent(url: string): FetchedContent {
  const meta = fetchVideoMeta(url);
  return { kind: "youtube", url, videoId: meta.id, title: meta.title, publishedAt: meta.uploadDate, cues: fetchCues(url), authorName: meta.channel };
}

/** The claims are extracted from a transcript the caller supplies. We still
 *  fetch the video's own cues, so that each claim's timestamp snaps onto them. */
export function fetchYoutubeTranscriptContent(url: string, transcriptText: string): FetchedContent {
  const meta = fetchVideoMeta(url);
  return {
    kind: "youtube-transcript",
    url,
    videoId: meta.id,
    title: meta.title,
    publishedAt: meta.uploadDate,
    text: transcriptText,
    cues: fetchCues(url),
    authorName: meta.channel,
  };
}
