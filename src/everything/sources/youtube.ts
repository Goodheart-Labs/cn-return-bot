import { execFileSync, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import { fetchTimedTranscript, ytDlpProxyArgs, type SubtitleCue } from "../../pipeline/media/ytDlpDownload";
import type { FetchedContent } from "../types";

export function ensureYtDlp(): void {
  try {
    execSync("yt-dlp --version", { stdio: "pipe" });
  } catch {
    console.error("yt-dlp is not installed. Install with: brew install yt-dlp");
    process.exit(1);
  }
}

/** yt-dlp reports upload_date as YYYYMMDD. This converts it to YYYY-MM-DD.
 *  It returns undefined when yt-dlp gave no date at all. */
function parseUploadDate(raw: string): string | undefined {
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/** Fetches the video's id, title and upload date. We ask yt-dlp to print just
 *  those three fields. Asking for the full -J metadata instead would overflow
 *  the child process output buffer on YouTube videos. */
function fetchVideoMeta(url: string): { id: string; title: string; uploadDate?: string } {
  // The title is printed last because a title can span several lines.
  // Everything after the first two lines is joined back together as the title,
  // so a multi-line title cannot swallow the other fields.
  const out = execFileSync(
    "yt-dlp",
    [...ytDlpProxyArgs(url), "--skip-download", "--no-warnings", "--print", "%(upload_date)s", "--print", "%(id)s", "--print", "%(title)s", url],
    { encoding: "utf8", timeout: 120_000 },
  );
  const [uploadDate = "", id = "", ...titleParts] = out.trim().split("\n");
  return { id, title: titleParts.join(" ").trim(), uploadDate: parseUploadDate(uploadDate) };
}

export interface ChannelVideo {
  videoId: string;
  url: string;
  title: string;
  durationSeconds: number | null;
}

/** Returns the latest videos from a channel's /videos tab, newest first. That
 *  tab does not list Shorts, so Shorts never appear here. One flat-playlist
 *  yt-dlp call fetches the whole list. The duration is null for a premiere or
 *  an upcoming video, because yt-dlp does not know it yet. */
export function fetchChannelVideos(channelUrl: string, limit: number): ChannelVideo[] {
  const out = execFileSync(
    "yt-dlp",
    [
      ...ytDlpProxyArgs(channelUrl),
      "--flat-playlist",
      "--no-warnings",
      "--playlist-items",
      `1:${limit}`,
      "--print",
      "%(id)s\t%(duration)s\t%(title)s",
      `${channelUrl.replace(/\/$/, "")}/videos`,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
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

/** Fetches the video's timestamped subtitle cues. The temporary download
 *  directory is always removed. It throws when the video has no transcript. */
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

/** Builds the content for a video whose claims will be extracted from a
 *  transcript the caller supplies, not from the video's own subtitles. The
 *  subtitle cues are still fetched, so each claim's timestamp can be snapped
 *  onto the real video. */
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
