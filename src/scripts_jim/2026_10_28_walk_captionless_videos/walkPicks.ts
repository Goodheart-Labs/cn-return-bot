/**
 * GOO-602: every YouTube feed item the walk put in the queue since a given day,
 * how it ended, and what the Data API's videos.list says about its captions
 * and age rating. videos.list costs 1 quota unit per 50 videos.
 *
 *   bun run src/scripts_jim/2026_10_28_walk_captionless_videos/walkPicks.ts [--since 2026-10-21]
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

const since = process.argv.includes("--since") ? process.argv[process.argv.indexOf("--since") + 1]! : "2026-10-21";
const OUT_FILE = path.join(import.meta.dir, "walkPicks.json");
const REQUESTED_TIER = 2;
const VIDEOS_PER_CALL = 50;

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const items: any[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("everything_items")
    .select("id, url, title, priority, status, skip_reason, error, retries, created_at, processed_at, published_at, project:everything_projects(slug)")
    .eq("source", "youtube")
    .lt("priority", REQUESTED_TIER)
    .gte("created_at", since)
    .order("created_at")
    .range(from, from + 999);
  if (error) throw error;
  items.push(...data!);
  if (data!.length < 1000) break;
}

const videoId = (url: string) => new URL(url).searchParams.get("v")!;
const details = new Map<string, any>();
const ids = items.map((i) => videoId(i.url));
for (let i = 0; i < ids.length; i += VIDEOS_PER_CALL) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids.slice(i, i + VIDEOS_PER_CALL).join(",")}&key=${process.env.YOUTUBE_DATA_V3_API_KEY}`);
  const body: any = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(body.error));
  for (const v of body.items) details.set(v.id, v.contentDetails);
}

const rows = items.map((i) => {
  const cd = details.get(videoId(i.url));
  return {
    created: i.created_at.slice(0, 16),
    channel: i.project?.slug,
    status: i.status,
    skip: i.skip_reason,
    retries: i.retries,
    uploadedCaption: cd?.caption ?? null,
    ageRestricted: cd?.contentRating?.ytRating === "ytAgeRestricted",
    url: i.url,
    error: i.error?.slice(0, 120) ?? null,
  };
});
fs.writeFileSync(OUT_FILE, JSON.stringify(rows, null, 1));

const outcome = (r: any) => (r.skip === "no captions" || r.skip === "age-restricted" ? r.skip : r.status === "done" ? "read" : r.status);
const tally = new Map<string, number>();
for (const r of rows) {
  const key = `${outcome(r)} | caption=${r.uploadedCaption} | ageFlag=${r.ageRestricted}`;
  tally.set(key, (tally.get(key) ?? 0) + 1);
}
console.log(`${rows.length} YouTube feed items created since ${since}`);
for (const [k, n] of [...tally].sort()) console.log(`  ${n.toString().padStart(4)}  ${k}`);

const byChannel = new Map<string, { read: number; unreadable: number; other: number }>();
for (const r of rows) {
  const c = byChannel.get(r.channel) ?? { read: 0, unreadable: 0, other: 0 };
  const o = outcome(r);
  if (o === "read") c.read++;
  else if (o === "no captions" || o === "age-restricted") c.unreadable++;
  else c.other++;
  byChannel.set(r.channel, c);
}
console.log("\nper channel (read / unreadable / other):");
for (const [ch, c] of [...byChannel].sort((a, b) => b[1].unreadable - a[1].unreadable)) console.log(`  ${String(c.read).padStart(3)} ${String(c.unreadable).padStart(3)} ${String(c.other).padStart(3)}  ${ch}`);
