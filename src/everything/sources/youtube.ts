import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import { execYtDlp, fetchTimedTranscript, type SubtitleCue } from "../../pipeline/media/ytDlpDownload";
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

/** Fetch the id, the title and the upload date by printing just those fields.
 *  We do not ask for the full -J metadata here. For a YouTube video that JSON
 *  is large enough to overflow the output buffer of the yt-dlp child process. */
function fetchVideoMeta(url: string): { id: string; title: string; uploadDate?: string } {
  // We print the title last because a title can span several lines. Everything
  // after the id therefore belongs to the title, and the earlier fields stay
  // readable.
  const out = execYtDlp(url, ["--skip-download", "--no-warnings", "--print", "%(upload_date)s", "--print", "%(id)s", "--print", "%(title)s", url]);
  const [uploadDate = "", id = "", ...titleParts] = out.trim().split("\n");
  return { id, title: titleParts.join(" ").trim(), uploadDate: parseUploadDate(uploadDate) };
}

export interface ChannelVideo {
  videoId: string;
  url: string;
  title: string;
  durationSeconds: number | null;
}

/** List the latest videos on a channel's /videos tab with a single
 *  flat-playlist yt-dlp call. The newest video comes first and Shorts are left
 *  out, because that tab does not list them. The duration is null for a
 *  premiere and for a video that has not aired yet. */
export function fetchChannelVideos(channelUrl: string, limit: number): ChannelVideo[] {
  const out = execYtDlp(channelUrl, [
    "--flat-playlist",
    "--no-warnings",
    "--playlist-items",
    `1:${limit}`,
    "--print",
    "%(id)s\t%(duration)s\t%(title)s",
    `${channelUrl.replace(/\/$/, "")}/videos`,
  ]);
  const videos = out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
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
  return videos;
}

const TRANSCRIPT_LANG = "en";

/** Fetch the video's timestamped cues. The temporary directory is always
 *  removed afterwards. This throws when the video has no transcript. */
function fetchCues(url: string): SubtitleCue[] {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "cn-yt-subs-"));
  try {
    const cues = fetchTimedTranscript(url, dir, TRANSCRIPT_LANG);
    if (!cues || cues.length === 0) throw new Error(`No ${TRANSCRIPT_LANG} transcript available for ${url}`);
    return cues;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function fetchYoutubeContent(url: string): FetchedContent {
  const meta = fetchVideoMeta(url);
  return { kind: "youtube", url, videoId: meta.id, title: meta.title, publishedAt: meta.uploadDate, cues: fetchCues(url) };
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
  };
}
