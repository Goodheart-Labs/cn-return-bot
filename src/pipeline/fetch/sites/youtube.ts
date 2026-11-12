/**
 * YouTube videos. A video's text is its captions, which come through yt-dlp
 * and the residential proxy (youtubeCaptions.ts). The video's details come
 * from the Data API.
 */

import { extractYoutubeVideoId } from "../../../everything-core/pageUrls";
import type { PageRead } from "../../../service/contract";
import { captionsToText, fetchYoutubeCaptions } from "../../media/youtubeCaptions";
import { fetchVideos } from "../../media/youtubeDataApi";

/** How old a video must be before we believe it will never get captions.
 *  WebSub lets us try a video minutes after upload, before YouTube has made
 *  its automatic captions. In October 2026, 14 of 24 videos that had no
 *  captions in their first hour got them later. Of 66 videos older than a
 *  day, 1 did (GOO-422). */
const CAPTIONS_GRACE_HOURS = 24;

const ageHours = (publishedTime: string): number => (Date.now() - new Date(publishedTime).getTime()) / 3600_000;

/** Reads a video's captions. When YouTube cannot be reached at all, this
 *  throws YoutubeUnreachableError, so that a proxy outage is never recorded as
 *  a video without captions. */
export async function readYoutubeVideo(url: string): Promise<PageRead> {
  const videoId = extractYoutubeVideoId(url);
  if (!videoId) throw new Error(`Not a YouTube video URL: ${url}`);
  const [video] = await fetchVideos([videoId]);
  if (!video) return { type: "unreadable", reason: `YouTube knows no video ${videoId} (private or removed)` };
  if (video.upcoming) return { type: "unreadable", reason: `${url} is a premiere that has not aired yet` };
  const captions = await fetchYoutubeCaptions(video);
  if (captions.kind === "age_restricted") return { type: "unreadable_video", reason: "age-restricted", captionsMayStillCome: false };
  if (captions.kind !== "captions") {
    return { type: "unreadable_video", reason: "no captions", captionsMayStillCome: ageHours(video.publishedTime) < CAPTIONS_GRACE_HOURS, why: captions.why };
  }
  return {
    type: "page",
    page: {
      url,
      title: video.title,
      text: captionsToText(captions.cues),
      publishedAt: video.publishedAt,
      authorName: video.channelTitle,
      source: { kind: "youtube", videoId: video.videoId, cues: captions.cues },
    },
  };
}
