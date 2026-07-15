/**
 * Enqueue content for the everything pipeline — the single ingestion front door.
 *
 * Everything lands under a project (`--project <slug>`, created if new) as one
 * item per source document. An item is either a live URL the worker fetches, or
 * a local document whose text you supply.
 *
 * Usage:
 *   bun run src/everything/enqueue.ts --project <slug> [args...]
 *
 * Args (mix freely):
 *   <url>                     live YouTube video, Substack post, or Substack
 *                             profile (expands to its --latest N free posts)
 *   --doc <url> <file>        a source <url> plus a local .md/.txt <file> whose
 *                             text is the extraction body. A YouTube <url> still
 *                             fetches the video's cues for timestamps; any other
 *                             url is treated as an article (text-anchored).
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
import { enqueueItems, resolveProjectId, type EnqueueRow } from "./db";
import { fetchLatestFreePostUrls, parseProfileHandle } from "./sources/substack";
import type { SourceKind } from "./types";

const DEFAULT_LATEST_POSTS = 5;

/** A YouTube link snaps to video cues; anything else is treated as an article. */
function classifyUrl(url: string): SourceKind {
  return /youtube\.com|youtu\.be/.test(url) ? "youtube" : "substack";
}

/** Live URLs: YouTube video, Substack post, or a Substack profile → its latest posts. */
async function expandLiveUrl(url: string, latest: number): Promise<{ source: SourceKind; url: string }[]> {
  if (/youtube\.com|youtu\.be/.test(url)) return [{ source: "youtube", url }];
  if (/\.substack\.com\/p\//.test(url)) return [{ source: "substack", url }];
  if (parseProfileHandle(url)) {
    const postUrls = await fetchLatestFreePostUrls(url, latest);
    console.log(`Profile ${url} → ${postUrls.length} latest free posts`);
    return postUrls.map((postUrl) => ({ source: "substack" as const, url: postUrl }));
  }
  throw new Error(`Unsupported URL (need a YouTube video, Substack post, or Substack profile): ${url}`);
}

/** "/supplements/alignment-roadmap" → "Alignment Roadmap"; "" → "Untitled". */
function titleFromPath(pagePath: string): string {
  const segment = pagePath.split("/").filter(Boolean).pop();
  if (!segment) return "Untitled";
  return segment.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A local doc's title: its first Markdown heading, else the filename. */
function titleFromDoc(text: string, file: string): string {
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || titleFromPath(path.basename(file, path.extname(file)));
}

/** Drop a trailing "### Links on this page" navigation block (manifest pages). */
function stripNav(text: string): string {
  return text.split(/\n#{2,3} Links on this page/)[0]!.trim();
}

/** One local document → an enqueue row. YouTube docs let the worker fetch the
 *  real title; article docs carry a title now since nothing re-fetches them. */
function docRow(projectId: string, url: string, text: string, title: string): EnqueueRow {
  const source = classifyUrl(url);
  const row: EnqueueRow = { project_id: projectId, source, url, full_text: text };
  if (source === "substack") row.title = title;
  return row;
}

/** Expand a folder's README.md manifest — a "Source: <base-url>" line and
 *  "- [title](file.md) — `/path`" rows — into one article doc per page. */
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
  const docs: { url: string; file: string }[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--project") projectSlug = args[++i];
    else if (a === "--manifest") manifestDir = args[++i];
    else if (a === "--latest") latest = Number(args[++i]);
    else if (a === "--doc") docs.push({ url: args[++i]!, file: args[++i]! });
    else if (a.startsWith("--")) throw new Error(`Unknown flag: ${a}`);
    else liveUrls.push(a);
  }

  if (!projectSlug || Number.isNaN(latest) || (liveUrls.length === 0 && docs.length === 0 && !manifestDir)) {
    console.error(
      "Usage: bun run src/everything/enqueue.ts --project <slug> [<url>...] [--doc <url> <file>]... [--manifest <dir>] [--latest N]",
    );
    process.exit(1);
  }

  const projectId = await resolveProjectId(projectSlug);
  const rows: EnqueueRow[] = [];
  for (const url of liveUrls) {
    const expanded = await expandLiveUrl(url, latest);
    rows.push(...expanded.map((r) => ({ ...r, project_id: projectId })));
  }
  for (const d of docs) {
    const text = fs.readFileSync(d.file, "utf8");
    rows.push(docRow(projectId, d.url, text, titleFromDoc(text, d.file)));
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
