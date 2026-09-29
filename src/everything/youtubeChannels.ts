/**
 * What the creator walk knows about each YouTube channel, so it asks the Data
 * API about a channel only when there may be something new (GOO-225).
 *
 * Until September 2026 every feed run listed every YouTube creator it passed.
 * That spent the 10,000 daily quota units by the afternoon, and after that no
 * channel could be listed until the reset. Now each channel's state lives in
 * everything_youtube_channels (migration 107):
 *
 *   - its permanent channel id, looked up once from the feed URL;
 *   - its newest uploads from the last listing, which the walk reads between
 *     listings;
 *   - when YouTube last told us it published something.
 *
 * YouTube tells us through WebSub, a web standard formerly called
 * PubSubHubbub. The walk subscribes each channel it reaches at Google's hub,
 * and the hub calls our Edge Function youtube-websub whenever the channel
 * uploads or edits a video (supabase/functions/youtube-websub). The function
 * stamps notified_at, and the next walk that passes the channel lists it.
 *
 * A channel is listed again for three reasons only: the walk has never listed
 * it, the hub has told us something since the last listing, or the last
 * listing is a day old. The daily listing is there because the hub now and
 * then fails to deliver a notification. A missed upload is then found within a
 * day rather than never.
 */

import { fetchYoutubeChannel, saveYoutubeChannel, type StoredUpload, type YoutubeChannelRow } from "./db";
import { fetchChannelUploads, resolveChannel } from "../pipeline/media/youtubeDataApi";

/** How old a listing may get before it is repeated without any notification. */
const RELIST_AFTER_HOURS = 24;

/** Google's hub, the server that sends us YouTube's notifications. */
const HUB_URL = "https://pubsubhubbub.appspot.com/subscribe";

/** How long we ask a subscription to last. The hub may grant less, but on
 *  2026-09-29 it granted the full ten days. */
const LEASE_SECONDS = 10 * 24 * 3600;

/** How old our last subscription request may get before the walk renews it.
 *  Three days short of the lease, so a creator the walk reaches only every few
 *  days still has a live subscription. */
export const RESUBSCRIBE_AFTER_DAYS = 7;

const HOUR_MS = 3600_000;

/** Why the walk asks the Data API about a channel this time. */
export type ListingReason = "first" | "notified" | "day old";

/** Whether a channel must be listed now, and why. Null means the stored
 *  listing is current. Exported for the tests. */
export function listingReason(row: Pick<YoutubeChannelRow, "listed_at" | "notified_at"> | null, now: Date): ListingReason | null {
  if (!row?.listed_at) return "first";
  const listedAt = Date.parse(row.listed_at);
  if (row.notified_at && Date.parse(row.notified_at) > listedAt) return "notified";
  if (listedAt < now.getTime() - RELIST_AFTER_HOURS * HOUR_MS) return "day old";
  return null;
}

const olderThanDays = (stamp: string | null, days: number, now: Date): boolean =>
  !stamp || Date.parse(stamp) < now.getTime() - days * 24 * HOUR_MS;

/** The address the hub sends notifications to: our Edge Function. */
const callbackUrl = (): string => `${process.env.SUPABASE_URL}/functions/v1/youtube-websub`;

/** Asks Google's hub to send us news about one channel. The hub answers 202
 *  and then confirms with our Edge Function on its own. */
async function subscribe(channelId: string): Promise<void> {
  const secret = process.env.YOUTUBE_WEBSUB_SECRET;
  if (!secret) throw new Error("Missing required environment variable: YOUTUBE_WEBSUB_SECRET");
  const response = await fetch(HUB_URL, {
    method: "POST",
    body: new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.topic": `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`,
      "hub.callback": callbackUrl(),
      "hub.verify": "async",
      "hub.secret": secret,
      "hub.lease_seconds": String(LEASE_SECONDS),
    }),
  });
  if (response.status !== 202) throw new Error(`WebSub hub answered ${response.status}: ${await response.text()}`);
}

/** The stored row for a feed, or a new one with its channel id looked up. A new
 *  row has no listing yet, so the walk lists it straight away. */
async function channelRow(feedUrl: string): Promise<YoutubeChannelRow> {
  const stored = await fetchYoutubeChannel(feedUrl);
  if (stored) return stored;
  const channel = await resolveChannel(feedUrl);
  return { feed_url: feedUrl, channel_id: channel.id, title: channel.title, uploads: [], listed_at: null, notified_at: null, subscribed_at: null };
}

/** A feed's YouTube channel id. The top-posts refresh uses it, so its scan does
 *  not pay for the lookup again. The walk has always stored the row by the
 *  time the refresh reaches a creator. */
export async function youtubeChannelId(feedUrl: string): Promise<string> {
  return (await channelRow(feedUrl)).channel_id;
}

const toStoredUpload = (v: { videoId: string; title: string; publishedAt: string; upcoming: boolean }): StoredUpload => ({
  videoId: v.videoId,
  title: v.title,
  publishedAt: v.publishedAt,
  upcoming: v.upcoming,
});

/** A channel's newest `limit` long-form uploads, newest first. They come from
 *  the Data API when listingReason says so, and from the stored listing
 *  otherwise. `listedBecause` is null when the stored listing was used.
 *
 *  The subscription is renewed here too, because this is where the walk meets
 *  the channel. A hub that refuses is logged and asked again on the next run;
 *  the daily listing still finds new uploads in the meantime. */
export async function youtubeChannelUploads(
  feedUrl: string,
  limit: number,
): Promise<{ title: string; uploads: StoredUpload[]; listedBecause: ListingReason | null }> {
  const now = new Date();
  const row = await channelRow(feedUrl);
  const listedBecause = listingReason(row, now);
  if (listedBecause) {
    // listed_at is the time before the call, so a notification that arrives
    // during the call is newer and makes the next walk list the channel again.
    row.uploads = (await fetchChannelUploads(row.channel_id, limit)).map(toStoredUpload);
    row.listed_at = now.toISOString();
  }
  const resubscribe = olderThanDays(row.subscribed_at, RESUBSCRIBE_AFTER_DAYS, now);
  if (resubscribe) {
    try {
      await subscribe(row.channel_id);
      row.subscribed_at = now.toISOString();
    } catch (err: any) {
      console.warn(`  could not subscribe to ${feedUrl} at the WebSub hub: ${err?.message}`);
    }
  }
  if (listedBecause || resubscribe) await saveYoutubeChannel(row);
  return { title: row.title, uploads: row.uploads.slice(0, limit), listedBecause };
}
