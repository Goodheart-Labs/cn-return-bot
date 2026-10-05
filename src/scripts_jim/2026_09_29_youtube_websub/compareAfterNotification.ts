/** GOO-225 probe: for a channel the hub just notified, prints the stored
 *  listing next to a fresh one, to see whether the new video is already in
 *  the long-form uploads playlist when the notification arrives. */
import "dotenv/config";
import { fetchYoutubeChannel } from "../../everything/db";
import { youtubeChannelUploads } from "../../everything/youtubeChannels";

const feedUrl = process.argv[2]!;
const before = await fetchYoutubeChannel(feedUrl);
console.log(`notified ${before?.notified_at} · listed ${before?.listed_at}`);
console.log("stored:", before?.uploads.map((u) => `${u.publishedAt} ${u.videoId} ${u.title}`));
const after = await youtubeChannelUploads(feedUrl, 5);
console.log(`fresh (${after.listedBecause ?? "stored"}):`, after.uploads.map((u) => `${u.publishedAt} ${u.videoId} ${u.title}`));
