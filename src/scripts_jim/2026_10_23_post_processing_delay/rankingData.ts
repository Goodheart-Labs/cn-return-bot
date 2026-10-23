/* Builds the data for the ranking playground page (GOO-549): per creator, the
 * number of recently visited posts and their total readers, the project's
 * name and whether it holds priority. Only creators that could plausibly rank
 * are kept, so the page stays small. The mean over all creators is kept too,
 * because the prior uses it. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
type Row = { creator: string; n: number; s: number };
const rows = (JSON.parse(readFileSync(new URL("./perCreatorMoments.json", import.meta.url), "utf8")) as Row[]).map((r) => ({ creator: r.creator, n: Number(r.n), s: Number(r.s) }));
const meanReaders = rows.reduce((a, r) => a + r.s, 0) / rows.reduce((a, r) => a + r.n, 0);
const { data: projects, error } = await db.from("everything_projects").select("name, feed_url, priority_until").not("feed_url", "is", null);
if (error) throw error;
const byKey = new Map(projects!.map((p) => [p.feed_url.toLowerCase().replace(/\/+$/, ""), p]));
const now = new Date().toISOString();
const KEEP_MIN_SCORE = 1.3;
const KEEP_MIN_POSTS = 4;
const creators = rows
  .map((r) => {
    const p = byKey.get(r.creator);
    return { url: r.creator, name: p?.name ?? null, posts: r.n, readers: r.s, priority: Boolean(p?.priority_until && p.priority_until > now) };
  })
  .filter((c) => c.readers / c.posts >= KEEP_MIN_SCORE || c.posts >= KEEP_MIN_POSTS || c.priority);
const priorityWithoutVisits = projects!.filter((p) => p.priority_until > now && !rows.some((r) => r.creator === p.feed_url.toLowerCase().replace(/\/+$/, "")));
for (const p of priorityWithoutVisits) creators.push({ url: p.feed_url.toLowerCase().replace(/\/+$/, ""), name: p.name, posts: 0, readers: 0, priority: true });
const out = { generatedAt: now, allCreators: rows.length, allPosts: rows.reduce((a, r) => a + r.n, 0), meanReaders, creators };
writeFileSync(new URL("./rankingData.json", import.meta.url), JSON.stringify(out));
console.log(creators.length, "creators kept of", rows.length, "· mean", meanReaders.toFixed(3), "· priority", creators.filter((c) => c.priority).length);
