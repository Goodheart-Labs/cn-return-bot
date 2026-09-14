/**
 * Lists every project that has a feed, next to the name its source uses today:
 * the Substack publication's RSS title, the YouTube channel's name, or the
 * LessWrong author's display name. A project whose stored name differs from
 * that is a candidate for renaming.
 *
 * Dry run by default: it prints the current name and the source's name for
 * every feed project. Run with --apply to write the source's name onto every
 * project where the two differ. Projects without a feed URL are never touched.
 *
 * Usage (yt-dlp must be on PATH for YouTube projects):
 *   bun run src/scripts_jim/2026_09_14_project_source_names/syncNames.ts [--apply]
 */

import "dotenv/config";
import { canonicalFeed, type CanonicalFeed } from "../../everything/feedUrls";
import { fetchFeedPosts } from "../../everything/sources/substack";
import { fetchChannelVideos } from "../../everything/sources/youtube";
import { fetchAuthorPosts } from "../../everything/sources/lesswrong";

/** The name a creator's source shows for them today. Each lookup is the same
 *  listing the walk makes for that feed type, so the script sees exactly the
 *  name the pipeline would write. */
async function fetchSourceDisplayName(feed: CanonicalFeed): Promise<string | undefined> {
  switch (feed.feed_type) {
    case "substack":
      return (await fetchFeedPosts(feed.feed_url)).title;
    case "youtube":
      return fetchChannelVideos(feed.feed_url, 1).channelName;
    case "lesswrong":
      return (await fetchAuthorPosts(feed.feed_url, 1)).authorName;
  }
}

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
  feed_url: string;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const projects = (await rest("everything_projects?select=id,slug,name,feed_url&feed_url=not.is.null&order=slug")) as Project[];
  console.log(`${projects.length} projects with a feed\n`);

  const renames: { project: Project; sourceName: string }[] = [];
  const unresolved: string[] = [];
  for (const project of projects) {
    const feed = canonicalFeed(project.feed_url);
    let sourceName: string | undefined;
    try {
      sourceName = feed ? await fetchSourceDisplayName(feed) : undefined;
    } catch (err: any) {
      console.log(`"${project.slug}": lookup failed: ${err?.message}`);
    }
    if (!sourceName) {
      unresolved.push(project.slug);
      console.log(`"${project.slug}" (${project.name}): no source name found, left as is`);
      continue;
    }
    if (sourceName === project.name) {
      console.log(`"${project.slug}": "${project.name}" already matches the source`);
      continue;
    }
    renames.push({ project, sourceName });
    console.log(`"${project.slug}": "${project.name}" -> "${sourceName}"`);
  }

  console.log(`\n${renames.length} projects differ from their source name.`);
  if (unresolved.length > 0) console.log(`Unresolved: ${unresolved.join(", ")}`);
  if (!apply) {
    console.log("Dry run, nothing written. Re-run with --apply to write.");
    return;
  }
  for (const { project, sourceName } of renames) {
    await rest(`everything_projects?id=eq.${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: sourceName }),
      headers: { Prefer: "return=minimal" },
    });
    console.log(`Renamed "${project.slug}" to "${sourceName}"`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
