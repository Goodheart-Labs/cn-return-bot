/**
 * Enqueue content for the everything pipeline. This is the single front door
 * for ingestion.
 *
 * Everything lands under a project, named by `--project <slug>` and created if
 * it is new. Each source document becomes one item. An item is either a live
 * URL that the worker fetches, or a local document whose text you supply.
 *
 * Usage:
 *   bun run src/everything/enqueue.ts --project <slug> [args...]
 *
 * Args (mix freely):
 *   <url>                     live YouTube video, Substack post, or Substack
 *                             profile (expands to its --latest N free posts)
 *   --doc [<url>] <file>      a local .md/.txt <file> whose text is the extraction
 *                             body. If you also give a source <url>, a YouTube
 *                             url still makes the worker fetch the video's cues
 *                             for timestamps. Any other url becomes the
 *                             article's source link. If you give no url, the
 *                             document has no source link and none is shown.
 *   --manifest <dir>          expand a folder's README.md manifest into --doc
 *                             pairs (one item per page)
 *   --latest N                posts to pull from a Substack profile (default 5)
 *
 * Examples:
 *   bun run src/everything/enqueue.ts --project dwarkesh https://youtu.be/XYZ
 *   bun run src/everything/enqueue.ts --project dwarkesh --doc https://youtu.be/XYZ transcript.md
 *   bun run src/everything/enqueue.ts --project ai-2040 --manifest scratchpad/ai-2040
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { enqueueItems, resolveProjectId, syntheticDocUrl, type EnqueueRow } from "./db";
import { fetchLatestFreePosts, parseProfileHandle } from "./sources/substack";
import type { SourceKind } from "./types";

const DEFAULT_LATEST_POSTS = 5;

/** A YouTube link has its claims snapped onto the video's cues. Anything else is
 *  treated as an article. */
function classifyUrl(url: string): SourceKind {
  return /youtube\.com|youtu\.be/.test(url) ? "youtube" : "substack";
}

/** Expands a live URL into the items it stands for. A YouTube video and a
 *  Substack post are one item each. A Substack profile expands to its latest
 *  posts, and its lookup also learns the publication's display name. */
async function expandLiveUrl(
  url: string,
  latest: number,
): Promise<{ items: { source: SourceKind; url: string }[]; projectName?: string }> {
  if (/youtube\.com|youtu\.be/.test(url)) return { items: [{ source: "youtube", url }] };
  if (/\.substack\.com\/p\//.test(url)) return { items: [{ source: "substack", url }] };
  if (parseProfileHandle(url)) {
    const { publicationName, posts } = await fetchLatestFreePosts(url, latest);
    console.log(`Profile ${url} → ${posts.length} latest free posts`);
    return { items: posts.map((post) => ({ source: "substack" as const, url: post.url })), projectName: publicationName };
  }
  throw new Error(`Unsupported URL (need a YouTube video, Substack post, or Substack profile): ${url}`);
}

/** Turns a page path into a title. "/supplements/alignment-roadmap" becomes
 *  "Alignment Roadmap". An empty path becomes "Untitled". */
function titleFromPath(pagePath: string): string {
  const segment = pagePath.split("/").filter(Boolean).pop();
  if (!segment) return "Untitled";
  return segment.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A local doc's title is its first Markdown heading. If it has no heading we
 *  build the title from the filename. */
function titleFromDoc(text: string, file: string): string {
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || titleFromPath(path.basename(file, path.extname(file)));
}

/** Drops the trailing "### Links on this page" navigation block that manifest
 *  pages carry. */
function stripNav(text: string): string {
  return text.split(/\n#{2,3} Links on this page/)[0]!.trim();
}

/** Turns one local document into an enqueue row. A YouTube document gets no
 *  title here, because the worker fetches the real one from the video. An
 *  article document carries its title right away, because nothing fetches that
 *  document again later. */
function docRow(projectId: string, url: string, text: string, title: string): EnqueueRow {
  const source = classifyUrl(url);
  const row: EnqueueRow = { project_id: projectId, source, url, full_text: text };
  if (source === "substack") row.title = title;
  return row;
}

/** Expands a folder's README.md manifest into one article document per page.
 *  Such a manifest has a "Source: <base-url>" line and rows of the form
 *  "- [title](file.md) — `/path`". */
function manifestRows(projectId: string, dir: string): EnqueueRow[] {
  const readme = fs.readFileSync(path.join(dir, "README.md"), "utf8");
  const baseUrl = readme.match(/Source:\s*(https?:\/\/[^\s·]+)/)?.[1]?.replace(/\/$/, "");
  if (!baseUrl) throw new Error(`${dir}/README.md has no 'Source: <url>' line`);
  const rows: EnqueueRow[] = [];
  for (const line of readme.split("\n")) {
    const m = line.match(/^- \[(.+?)\]\((.+?\.md)\) — `(.+?)`/);
    if (!m) continue;
    const [, title, file, pagePath] = m;
    const text = stripNav(fs.readFileSync(path.join(dir, file!), "utf8"));
    rows.push(docRow(projectId, `${baseUrl}${pagePath}`, text, title!.trim() || titleFromPath(pagePath!)));
  }
  if (rows.length === 0) throw new Error(`${dir}/README.md manifest has no page rows`);
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  let projectSlug: string | undefined;
  let manifestDir: string | undefined;
  let latest = DEFAULT_LATEST_POSTS;
  const liveUrls: string[] = [];
  const docs: { url: string | null; file: string }[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--project") projectSlug = args[++i];
    else if (a === "--manifest") manifestDir = args[++i];
    else if (a === "--latest") latest = Number(args[++i]);
    // --doc takes a file, and an optional source url may come before it. So
    // `--doc <url> <file>` pairs the two, and `--doc <file>` is a local
    // document with no url.
    else if (a === "--doc") {
      const first = args[++i]!;
      if (/^https?:\/\//.test(first)) docs.push({ url: first, file: args[++i]! });
      else docs.push({ url: null, file: first });
    } else if (a.startsWith("--")) throw new Error(`Unknown flag: ${a}`);
    else liveUrls.push(a);
  }

  if (!projectSlug || Number.isNaN(latest) || (liveUrls.length === 0 && docs.length === 0 && !manifestDir)) {
    console.error(
      "Usage: bun run src/everything/enqueue.ts --project <slug> [<url>...] [--doc [<url>] <file>]... [--manifest <dir>] [--latest N]",
    );
    process.exit(1);
  }

  // The live URLs are expanded before the project is resolved, because a
  // profile expansion is where the publication's display name comes from.
  const liveItems: { source: SourceKind; url: string }[] = [];
  let projectName: string | undefined;
  for (const url of liveUrls) {
    const expanded = await expandLiveUrl(url, latest);
    liveItems.push(...expanded.items);
    projectName ??= expanded.projectName;
  }

  const projectId = await resolveProjectId({ slug: projectSlug, displayName: projectName });
  const rows: EnqueueRow[] = liveItems.map((r) => ({ ...r, project_id: projectId }));
  for (const d of docs) {
    const text = fs.readFileSync(d.file, "utf8");
    const url = d.url ?? syntheticDocUrl(projectSlug, path.basename(d.file));
    rows.push(docRow(projectId, url, text, titleFromDoc(text, d.file)));
  }
  if (manifestDir) rows.push(...manifestRows(projectId, manifestDir));

  const inserted = await enqueueItems(rows);
  console.log(`Project "${projectSlug}" — enqueued ${inserted} new item(s) (${rows.length - inserted} already known):`);
  for (const row of rows) console.log(`  [${row.source}]${row.full_text ? " (local)" : ""} ${row.url}`);
}

main().catch((err) => {
  console.error("[enqueue] Fatal error:", err);
  process.exit(1);
});
