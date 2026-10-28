/**
 * GOO-603: every video we ended as "no captions" since a given day, with the
 * caption tracks YouTube's captions.list says it has. captions.list costs 50
 * Data API units per video, so the result is cached in the folder.
 *
 *   bun run src/scripts_jim/2026_10_27_youtube_captions_skipped/listSkipped.ts [--since 2026-10-18]
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

const since = process.argv.includes("--since") ? process.argv[process.argv.indexOf("--since") + 1]! : "2026-10-18";
const CACHE_FILE = path.join(import.meta.dir, "captionsListCache.json");
const OUT_FILE = path.join(import.meta.dir, "skipped.json");

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const cache: Record<string, { language: string; trackKind: string; name: string }[]> = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) : {};

async function captionTracks(videoId: string) {
  if (cache[videoId]) return cache[videoId];
  const res = await fetch(`https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}&key=${process.env.YOUTUBE_DATA_V3_API_KEY}`);
  const body: any = await res.json();
  if (!res.ok) throw new Error(`captions.list ${videoId}: ${JSON.stringify(body.error?.errors ?? body)}`);
  cache[videoId] = body.items.map((item: any) => ({ language: item.snippet.language, trackKind: item.snippet.trackKind, name: item.snippet.name }));
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
  return cache[videoId];
}

const { data: items, error } = await db
  .from("everything_items")
  .select("id, url, title, priority, retries, processed_at, published_at, project:everything_projects(slug)")
  .eq("source", "youtube")
  .eq("skip_reason", "no captions")
  .gte("processed_at", since)
  .order("processed_at");
if (error) throw error;

const rows = [];
for (const item of items!) {
  const videoId = new URL(item.url).searchParams.get("v") ?? item.url.split("/").pop()!;
  const tracks = await captionTracks(videoId);
  rows.push({ ...item, videoId, tracks });
  const summary = tracks.map((t) => `${t.language}/${t.trackKind}`).join(" ") || "none";
  console.log(`${item.processed_at?.slice(0, 16)} p${item.priority} r${item.retries} ${(item.project as any)?.slug?.padEnd(24)} ${videoId} ${summary}`);
}
fs.writeFileSync(OUT_FILE, JSON.stringify(rows, null, 1));
console.log(`\n${rows.length} videos, ${rows.filter((r) => r.tracks.length).length} with tracks in captions.list (${since} to now)`);
