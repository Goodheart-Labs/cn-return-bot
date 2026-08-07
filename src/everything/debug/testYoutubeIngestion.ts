/**
 * Temporary CI test for YouTube ingestion — run by the Test YouTube Ingestion
 * workflow to verify that the yt-dlp installed on the runner can list a
 * channel and fetch a video's metadata and transcript cues. Delete together
 * with .github/workflows/test-youtube-ingestion.yml once verified.
 *
 * Usage: bun run src/everything/debug/testYoutubeIngestion.ts
 */

import { fetchChannelVideos, fetchYoutubeContent } from "../sources/youtube";

const CHANNEL_URL = "https://www.youtube.com/@DwarkeshPatel";
const LISTING_LIMIT = 15;

const videos = fetchChannelVideos(CHANNEL_URL, LISTING_LIMIT);
console.log(`Listed ${videos.length} videos:`);
for (const v of videos) console.log(`  ${v.videoId}  ${v.durationSeconds ?? "upcoming"}  ${v.title}`);

const shortest = videos
  .filter((v) => v.durationSeconds !== null)
  .sort((a, b) => a.durationSeconds! - b.durationSeconds!)[0];
if (!shortest) throw new Error("No watchable video in the listing to test metadata and cues on");

console.log(`\nFetching metadata + transcript cues for the shortest video: ${shortest.title}`);
const content = fetchYoutubeContent(shortest.url);
if (content.kind !== "youtube") throw new Error(`Unexpected content kind: ${content.kind}`);
console.log(`Fetched "${content.title}" (published ${content.publishedAt}) with ${content.cues.length} transcript cues`);
if (content.cues.length === 0) throw new Error("Video fetched but no transcript cues came back");

console.log("\nYouTube ingestion works on this machine ✅");
