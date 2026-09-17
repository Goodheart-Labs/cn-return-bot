/**
 * YouTube's official Data API v3. Everything the pipeline asks YouTube about
 * a channel or a video, other than the captions themselves, comes from here:
 * which videos a channel has, when they were published, how long they are and
 * how often they were viewed. The API answers a datacenter address in well
 * under a second and never asks anyone to sign in, which is what the channel
 * listings through yt-dlp and the residential proxy could not promise
 * (GOO-169: the listings hung on YouTube's internal API most of 2026-09-16).
 *
 * Quota: a Google Cloud project gets 10,000 units a day for free. Every list
 * call here costs one unit, whatever it returns, so a 3000-video channel scan
 * is about 120 units and a walk listing is two. Search would cost 100 a call
 * and is not used.
 *
 * The key is YOUTUBE_DATA_V3_API_KEY, a plain API key restricted to this API.
 */

import { extractYoutubeVideoId } from "../../everything-shared/pageUrls";

const API_ROOT = "https://www.googleapis.com/youtube/v3";

/** The most items one list call returns. */
const PAGE_SIZE = 50;

/** How deep the all-time-top scan reads a channel's uploads. Joe Rogan's
 *  channel holds about 3050 long-form videos and its most viewed episodes sit
 *  past position 2000, so a shallower scan would miss the videos the scan is
 *  for. Sixty list calls plus sixty statistics calls at this depth. */
export const TOP_VIDEOS_SCAN_LIMIT = 3000;

export interface YoutubeChannel {
  id: string;
  title: string;
}

export interface YoutubeVideo {
  videoId: string;
  url: string;
  title: string;
  channelTitle: string;
  /** The publish day, YYYY-MM-DD. */
  publishedAt: string;
  viewCount: number;
  /** Null for a live stream or a premiere that has not aired, which the API
   *  reports with a zero-length duration. */
  durationSeconds: number | null;
  /** True for a premiere or stream that has not started. It cannot be watched
   *  yet, so it has no captions and must not be enqueued. */
  upcoming: boolean;
}

function apiKey(): string {
  const key = process.env.YOUTUBE_DATA_V3_API_KEY;
  if (!key) throw new Error("Missing required environment variable: YOUTUBE_DATA_V3_API_KEY");
  return key;
}

async function apiGet(resource: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${API_ROOT}/${resource}`);
  for (const [name, value] of Object.entries({ ...params, key: apiKey() })) url.searchParams.set(name, value);
  const response = await fetch(url);
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    // The quota message is the one worth recognising at a glance in a log:
    // it means the day's 10,000 units are gone, not that YouTube is down.
    const reason = body?.error?.errors?.[0]?.reason;
    const message = body?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`YouTube Data API ${resource} failed${reason ? ` (${reason})` : ""}: ${message}`);
  }
  return body;
}

/** The channel a feed URL names. A feed URL is either an @handle or a
 *  /channel/UC… id (see canonicalYoutubeFeed in feedUrls.ts). */
export async function resolveChannel(channelUrl: string): Promise<YoutubeChannel> {
  const handle = channelUrl.match(/youtube\.com\/(@[\w.-]+)/)?.[1];
  const id = channelUrl.match(/youtube\.com\/channel\/(UC[\w-]{22})/)?.[1];
  if (!handle && !id) throw new Error(`Not a YouTube channel URL: ${channelUrl}`);
  const body = await apiGet("channels", { part: "snippet", ...(id ? { id } : { forHandle: handle! }) });
  const item = body.items?.[0];
  if (!item) throw new Error(`YouTube knows no channel at ${channelUrl}`);
  return { id: item.id, title: item.snippet.title };
}

/** The playlist holding a channel's long-form uploads, newest first: the same
 *  list the channel's Videos tab shows, without Shorts and live streams.
 *  Google documents only the plain uploads playlist (UU + the channel id
 *  without its UC prefix); the UULF variant is undocumented but has been
 *  stable for years and is what keeps Shorts out of the walk. */
export const longFormUploadsPlaylist = (channelId: string): string => `UULF${channelId.slice(2)}`;

/** The newest `limit` video ids of a playlist, in playlist order. A private
 *  or deleted video still has a row in the playlist but no publish date, and
 *  is left out. */
async function listPlaylistVideoIds(playlistId: string, limit: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < limit) {
    const body = await apiGet("playlistItems", {
      part: "contentDetails",
      playlistId,
      maxResults: String(Math.min(PAGE_SIZE, limit - ids.length)),
      ...(pageToken ? { pageToken } : {}),
    });
    for (const item of body.items ?? []) {
      if (item.contentDetails?.videoPublishedAt) ids.push(item.contentDetails.videoId);
    }
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return ids;
}

/** Turns the API's ISO 8601 duration (PT1H2M3S) into seconds. Exported for
 *  the tests. */
export function parseIsoDuration(iso: string): number {
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const [, d = "0", h = "0", min = "0", s = "0"] = m;
  return Number(d) * 86400 + Number(h) * 3600 + Number(min) * 60 + Number(s);
}

function toVideo(item: any): YoutubeVideo {
  const seconds = parseIsoDuration(item.contentDetails?.duration ?? "");
  return {
    videoId: item.id,
    url: `https://www.youtube.com/watch?v=${item.id}`,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt.slice(0, 10),
    viewCount: Number(item.statistics?.viewCount ?? 0),
    durationSeconds: seconds > 0 ? seconds : null,
    upcoming: item.snippet.liveBroadcastContent === "upcoming",
  };
}

/** The details of the given videos, in the order asked for. A video the API
 *  does not return (private, removed) is simply absent. */
export async function fetchVideos(videoIds: string[]): Promise<YoutubeVideo[]> {
  const byId = new Map<string, YoutubeVideo>();
  for (let i = 0; i < videoIds.length; i += PAGE_SIZE) {
    const body = await apiGet("videos", { part: "snippet,contentDetails,statistics", id: videoIds.slice(i, i + PAGE_SIZE).join(",") });
    for (const item of body.items ?? []) byId.set(item.id, toVideo(item));
  }
  return videoIds.flatMap((id) => byId.get(id) ?? []);
}

/** One video, by its page URL. Throws when YouTube does not know it, which is
 *  what a private or removed video looks like. */
export async function fetchVideo(url: string): Promise<YoutubeVideo> {
  const id = extractYoutubeVideoId(url);
  if (!id) throw new Error(`Not a YouTube video URL: ${url}`);
  const [video] = await fetchVideos([id]);
  if (!video) throw new Error(`YouTube knows no video ${id} (private or removed)`);
  return video;
}

/** A channel's newest long-form uploads with their details, newest first.
 *  Two or three list calls per channel. */
export async function fetchChannelUploads(channelUrl: string, limit: number): Promise<{ channel: YoutubeChannel; videos: YoutubeVideo[] }> {
  const channel = await resolveChannel(channelUrl);
  const ids = await listPlaylistVideoIds(longFormUploadsPlaylist(channel.id), limit);
  return { channel, videos: await fetchVideos(ids) };
}

/** A channel's `n` most viewed long-form videos, most viewed first, from a
 *  scan of its newest `scanLimit` uploads. */
export async function fetchChannelTopVideos(channelUrl: string, n: number, scanLimit = TOP_VIDEOS_SCAN_LIMIT): Promise<{ channel: YoutubeChannel; videos: YoutubeVideo[] }> {
  const channel = await resolveChannel(channelUrl);
  const ids = await listPlaylistVideoIds(longFormUploadsPlaylist(channel.id), scanLimit);
  const videos = await fetchVideos(ids);
  return { channel, videos: videos.sort((a, b) => b.viewCount - a.viewCount).slice(0, n) };
}
