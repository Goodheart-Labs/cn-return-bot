/** Reads the first pages of the XXL feed with the first account's keys and
 *  compares them with cn-feed-views' newest XL walk (GOO-880). It stops while X
 *  has fewer than SAFE_RATE_REMAINING requests left. Two walks of 102 requests
 *  can fall into one 15-minute window, and a walk stops below 150, so 360 keeps
 *  the walk whole. The keys live only on the services box, so it runs there:
 *
 *    scp xxlProbe.ts root@<box>:/tmp/ && ssh root@<box> systemd-run --wait --pipe --collect \
 *      -p User=cnbot -p EnvironmentFile=/etc/cn-return-bot/service.env \
 *      -p WorkingDirectory=/opt/cn-return-bot /home/cnbot/.bun/bin/bun run /tmp/xxlProbe.ts
 */
import { createClient } from "@supabase/supabase-js";
import { walkEligiblePages } from "/opt/cn-return-bot/src/api/fetchEligiblePosts";
import { buildPostSelection } from "/opt/cn-return-bot/src/pipeline/orchestration/utils/feedSizeStrategy";

const MAX_PAGES = 120;
const SAFE_RATE_REMAINING = 360;
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data: lastWalk, error } = await db.from("feed_view_walks").select("started_at, finished_at").eq("complete", true).order("started_at", { ascending: false }).limit(1).single();
if (error) throw error;
const xl = new Set<string>();
for (let from = 0; ; from += 1000) {
  const { data, error: e } = await db.from("feed_tweet_views").select("tweet_id::text").gte("observed_at", lastWalk.started_at).lte("observed_at", lastWalk.finished_at).range(from, from + 999);
  if (e) throw e;
  for (const r of data as { tweet_id: string }[]) xl.add(r.tweet_id);
  if (data.length < 1000) break;
}
console.log(`newest XL walk ${lastWalk.started_at}: ${xl.size} posts`);
type Seen = { inXl: boolean; long: boolean; imp: number; ageH: number; page: number };
const seen = new Map<string, Seen>();
let pages = 0, last = false, rate: number | null = null;
for await (const page of walkEligiblePages(buildPostSelection("xxl"))) {
  pages++; rate = page.rateRemaining; last = page.isLastPage;
  for (const p of page.posts) if (!seen.has(p.id)) seen.set(p.id, { inXl: xl.has(p.id), long: (p.text?.length ?? 0) > 280 || Boolean((p.raw as any)?.article), imp: p.public_metrics?.impression_count ?? 0, ageH: (Date.now() - Date.parse(p.created_at)) / 3.6e6, page: pages });
  if (pages % 10 === 0) console.log(`page ${pages}: ${seen.size} posts, ${[...seen.values()].filter((s) => !s.inXl).length} not in XL, rate left ${rate}`);
  if (last || pages >= MAX_PAGES || (rate ?? 0) < SAFE_RATE_REMAINING) break;
}
const all = [...seen.values()];
const notXl = all.filter((s) => !s.inXl);
console.log(`read ${pages} pages (${last ? "whole feed" : "stopped early"}), ${all.length} posts, ${notXl.length} not in the XL walk, ${all.length - notXl.length} in it; rate left ${rate}`);
console.log(`first page with a post not in XL: ${Math.min(...notXl.map((s) => s.page))}; XL posts by page decile:`, Array.from({ length: 10 }, (_, d) => { const inD = all.filter((s) => Math.ceil(s.page / Math.max(1, pages / 10)) === d + 1); return inD.length ? Math.round(100 * inD.filter((s) => s.inXl).length / inD.length) : null; }));
for (const min of [10_000, 100_000, 1_000_000]) {
  const big = (rows: Seen[]) => rows.filter((s) => s.long && s.imp >= min && s.ageH < 48).length;
  console.log(`long-form under 48h with >= ${min} views: ${big(notXl)} only in XXL, ${big(all.filter((s) => s.inXl))} also in XL`);
}
