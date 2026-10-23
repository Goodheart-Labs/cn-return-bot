/* For the creators in Jim's ranking table, compares each recent post's exact
 * publication time with when the walk enqueued it and when its check finished.
 * Substack times come from the RSS feed fetched directly, YouTube times from
 * the walk's stored channel listing, forum times from the LessWrong API. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { fetchAuthorPosts } from "../../everything/sources/lesswrong";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SLUGS = ["thezvi", "astralcodexten", "dwarkeshpatel", "aiexplained-official", "andymasley", "eightythousandhours", "visualpolitik", "benthams", "moneymacro", "wired", "randombytes", "vanessa-kosoy", "joec", "l-rudolf-l", "milo-moses", "verysane", "leogao", "ai_in_context", "haoxing-du", "kurzgesagt"];
const POSTS_PER_CREATOR = 10;
const NOT_BEFORE = "2026-10-01";

const { data: projects, error } = await db.from("everything_projects").select("id, slug, feed_url, priority_until").not("feed_url", "is", null);
if (error) throw error;
type Post = { key: string; title: string; publishedAt: string };

async function substackPosts(feedUrl: string): Promise<Post[]> {
  const xml = await (await fetch(`${feedUrl.replace(/\/$/, "")}/feed`, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => ({
    key: item!.match(/<link>([^<]*)<\/link>/)![1]!.trim(),
    title: item!.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)![1]!,
    publishedAt: new Date(item!.match(/<pubDate>([^<]*)<\/pubDate>/)![1]!).toISOString(),
  }));
}
async function youtubePosts(feedUrl: string): Promise<Post[]> {
  const { data } = await db.from("everything_youtube_channels").select("uploads").eq("feed_url", feedUrl).maybeSingle();
  return ((data?.uploads ?? []) as { videoId: string; title: string; publishedAt: string }[]).map((u) => ({ key: u.videoId, title: u.title, publishedAt: u.publishedAt }));
}
async function forumPosts(feedUrl: string): Promise<Post[]> {
  return (await fetchAuthorPosts(feedUrl, POSTS_PER_CREATOR)).posts.map((p: any) => ({ key: p.matchKey ?? p.url, title: p.title, publishedAt: p.publishedAt }));
}

const rows: any[] = [];
for (const slug of SLUGS) {
  const project = projects!.find((p) => p.slug === slug);
  if (!project) { console.log("missing project", slug); continue; }
  const feed: string = project.feed_url;
  const posts = feed.includes("youtube.com") ? await youtubePosts(feed) : feed.includes("lesswrong.com") || feed.includes("alignmentforum.org") ? await forumPosts(feed) : await substackPosts(feed);
  const { data: items } = await db.from("everything_items").select("url, status, retries, created_at, processed_at, checked_scope, skip_reason, error").eq("project_id", project.id);
  for (const post of posts.filter((p) => p.publishedAt >= NOT_BEFORE).slice(0, POSTS_PER_CREATOR)) {
    const item = items!.find((i) => i.url.includes(post.key) || post.key.includes(i.url));
    rows.push({ slug, priorityUntil: project.priority_until, ...post, item: item ?? null });
  }
}
writeFileSync(new URL("./exactDelay.json", import.meta.url), JSON.stringify(rows, null, 1));
const h = (a: string, b: string) => ((new Date(b).getTime() - new Date(a).getTime()) / 3.6e6).toFixed(1).padStart(6);
for (const r of rows)
  console.log([r.slug.padEnd(20), r.publishedAt.slice(5, 16), r.item ? h(r.publishedAt, r.item.created_at) : "  none", r.item?.processed_at ? h(r.item.created_at, r.item.processed_at) : "     -", r.item?.processed_at ? h(r.publishedAt, r.item.processed_at) : "     -", (r.item?.status ?? "").padEnd(6), String(r.item?.retries ?? ""), (r.item?.skip_reason ?? r.item?.error ?? "").slice(0, 25).padEnd(25), r.title.slice(0, 40)].join(" "));
