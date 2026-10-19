/** GOO-225 probe: lists and subscribes a few frequently uploading channels
 *  through the walk's own code, so we can watch the hub confirm them and
 *  later see notifications arrive in everything_youtube_channels. */
import "dotenv/config";
import { youtubeChannelUploads } from "../../everything/youtubeChannels";

const FEEDS = process.argv.slice(2);

for (const feed of FEEDS) {
  const { title, uploads, listedBecause } = await youtubeChannelUploads(feed, 5);
  console.log(`${feed} · ${title} · listed: ${listedBecause ?? "stored"} · newest: ${uploads[0]?.publishedAt} ${uploads[0]?.title}`);
}
