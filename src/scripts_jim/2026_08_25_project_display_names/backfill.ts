/**
 * One-off backfill for GOO-50: fill in the real display names of projects that
 * were created knowing only their slug, so their name still equals the slug.
 *
 * For each such placeholder the script resolves the real name the same way the
 * pipeline now does at ingestion: from the followed feed's listing when the
 * project has one (Substack RSS channel title / YouTube channel name), and
 * otherwise from the project's items (the publication feed of a Substack
 * item's subdomain, or the channel of a YouTube item's video). A project whose
 * name it cannot resolve is reported and left unchanged.
 *
 * Dry run by default: it prints what it would write. Run with --apply to
 * write. Only projects whose name equals their slug are ever touched.
 *
 * Usage (yt-dlp must be on PATH for YouTube projects):
 *   bun run src/scripts_jim/2026_08_25_project_display_names/backfill.ts [--apply]
 */

import "dotenv/config";
import { execSync } from "child_process";
import { fetchFeedPosts } from "../../everything/sources/substack";
import { fetchChannelVideos } from "../../everything/sources/youtube";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_KEY!;
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function rest(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

interface Project {
  id: string;
  slug: string;
  name: string;
}

/** The channel name of a single video, printed by yt-dlp. */
function videoChannel(videoUrl: string): string | undefined {
  const out = execSync(
    `yt-dlp --skip-download --ignore-no-formats-error --no-warnings --print "%(channel)s" ${JSON.stringify(videoUrl)}`,
    { encoding: "utf8", timeout: 60_000 },
  ).trim();
  return out && out !== "NA" ? out : undefined;
}

/** Resolves a project's display name from its items when it has no followed
 *  feed. Tries the items one by one and returns the first name found. */
async function nameFromItems(project: Project): Promise<string | undefined> {
  const items = (await rest(
    `everything_items?select=source,url&project_id=eq.${project.id}&limit=5`,
  )) as { source: string; url: string }[];
  for (const item of items) {
    try {
      const subdomain = item.url.match(/^https?:\/\/([\w-]+)\.substack\.com\//)?.[1];
      if (subdomain) {
        const { title } = await fetchFeedPosts(`https://${subdomain}.substack.com`);
        if (title) return title;
      }
      if (item.source === "youtube" && /^https?:/.test(item.url)) {
        const channel = videoChannel(item.url);
        if (channel) return channel;
      }
    } catch (err: any) {
      console.log(`  (item ${item.url} gave no name: ${err?.message})`);
    }
  }
  return undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const projects = (await rest("everything_projects?select=id,slug,name&order=slug")) as Project[];
  const feeds = (await rest("everything_followed_feeds?select=project_slug,feed_type,feed_url")) as {
    project_slug: string;
    feed_type: "substack" | "youtube";
    feed_url: string;
  }[];

  const placeholders = projects.filter((p) => p.name === p.slug);
  console.log(`${projects.length} projects, ${placeholders.length} with a placeholder name\n`);

  const unresolved: string[] = [];
  for (const project of placeholders) {
    const feed = feeds.find((f) => f.project_slug === project.slug);
    let name: string | undefined;
    try {
      if (feed?.feed_type === "substack") name = (await fetchFeedPosts(feed.feed_url)).title;
      else if (feed?.feed_type === "youtube") name = fetchChannelVideos(feed.feed_url, 1).channelName;
      else name = await nameFromItems(project);
    } catch (err: any) {
      console.log(`  (feed lookup for "${project.slug}" failed: ${err?.message})`);
    }

    if (!name || name === project.slug) {
      unresolved.push(project.slug);
      console.log(`"${project.slug}" — no display name found, left as is`);
      continue;
    }
    console.log(`"${project.slug}" → "${name}"${apply ? "" : " (dry run)"}`);
    if (apply) {
      await rest(`everything_projects?id=eq.${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
        headers: { Prefer: "return=minimal" },
      });
    }
  }

  if (unresolved.length > 0) console.log(`\nUnresolved: ${unresolved.join(", ")}`);
  if (!apply) console.log("\nDry run — nothing written. Re-run with --apply to write.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
