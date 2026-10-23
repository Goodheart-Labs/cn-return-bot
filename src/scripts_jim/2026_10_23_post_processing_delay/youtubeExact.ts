/* Exact upload times of the walked YouTube creators' recent videos, from
 * YouTube's public per-channel RSS feed, since the stored listing keeps only
 * the day. Compared with when the walk enqueued each video and when the
 * channel's WebSub notification arrived. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const NOT_BEFORE = "2026-10-15";
const { data: channels } = await db.from("everything_youtube_channels").select("feed_url, channel_id, notified_at, subscribed_at");
const { data: projects } = await db.from("everything_projects").select("id, slug, feed_url, priority_until").like("feed_url", "%youtube.com%");
const h = (a: string, b: string) => ((new Date(b).getTime() - new Date(a).getTime()) / 3.6e6).toFixed(1).padStart(6);
for (const project of projects!.filter((p) => p.priority_until > "2026-10-20")) {
  const channel = channels!.find((c) => c.feed_url === project.feed_url);
  if (!channel) continue;
  const xml = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channel_id}`)).text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({ id: e!.match(/<yt:videoId>([^<]*)/)?.[1], title: e!.match(/<title>([^<]*)/)?.[1] ?? "", published: e!.match(/<published>([^<]*)/)?.[1] ?? "" }));
  const { data: items } = await db.from("everything_items").select("url, status, retries, created_at, processed_at, skip_reason, error").eq("project_id", project.id);
  console.log(`== ${project.slug} (priority until ${project.priority_until?.slice(0, 10)}, subscribed ${channel.subscribed_at?.slice(0, 16)})`);
  for (const e of entries.filter((e) => e.published >= NOT_BEFORE)) {
    const item = items!.find((i) => i.url.includes(e.id!));
    console.log("  ", e.published.slice(5, 16), item ? h(e.published, item.created_at) : "  none", item?.processed_at ? h(e.published, item.processed_at) : "     -", item?.status ?? "", item?.retries ?? "", (item?.skip_reason ?? item?.error ?? "").slice(0, 30), e.title.slice(0, 50));
  }
}
