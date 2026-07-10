/**
 * Import a folder of scraped markdown pages as an everything-pipeline project,
 * running the full extract → drop-speculation → fact-check pipeline on each and
 * writing straight into the everything_* tables (shows on the public SPA).
 *
 * The folder's README.md is the manifest: a "Source: <base-url>" line and one
 * "- [title](file.md) — `/path` (n chars)" row per page. Each page becomes an
 * item whose url is <base-url><path>. Idempotent: re-running an item clears its
 * old claims first.
 *
 * Emits one [PROGRESS] line per page (claims per state) so a Monitor can stream
 * progress to the chat.
 *
 *   bun run src/everything/importFiles.ts <dir> <slug> <name...>
 *   bun run src/everything/importFiles.ts scratchpad/ai-2040 ai-2040 "AI 2040: Plan A"
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { deleteClaimsForItem, markItemDone, markItemError, upsertItem, upsertProject } from "./db";
import { processFetchedContent, type ItemTally } from "./processContent";
import type { FetchedContent } from "./types";

interface PageEntry {
  file: string;
  title: string;
  pagePath: string;
}

interface Manifest {
  baseUrl: string;
  pages: PageEntry[];
}

const GENERIC_SITE_TITLE = "AI 2040: Plan A";

/** Parse README.md: the "Source:" base url and the "- [title](file) — `/path`" rows. */
function parseManifest(dir: string): Manifest {
  const readme = fs.readFileSync(path.join(dir, "README.md"), "utf8");
  const baseUrl = readme.match(/Source:\s*(https?:\/\/[^\s·]+)/)?.[1]?.replace(/\/$/, "");
  if (!baseUrl) throw new Error("README.md has no 'Source: <url>' line");
  const pages: PageEntry[] = [];
  for (const line of readme.split("\n")) {
    const m = line.match(/^- \[(.+?)\]\((.+?\.md)\) — `(.+?)`/);
    if (m) pages.push({ title: m[1]!, file: m[2]!, pagePath: m[3]! });
  }
  if (pages.length === 0) throw new Error("README.md manifest has no page rows");
  return { baseUrl, pages };
}

/** "/supplements/alignment-roadmap" → "Alignment Roadmap"; "/" → "Main Scenario". */
function titleFromPath(pagePath: string): string {
  const segment = pagePath.split("/").filter(Boolean).pop();
  if (!segment) return "Main Scenario";
  const titled = segment.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return titled.replace(/\bAi\b/g, "AI").replace(/\bFaq\b/g, "FAQ");
}

/** Prefer a descriptive manifest title (minus the " — AI 2040" site suffix); else derive from the path. */
function displayTitle(entry: PageEntry): string {
  const stripped = entry.title.replace(/\s*—\s*AI 2040\s*$/, "").trim();
  return stripped && stripped !== GENERIC_SITE_TITLE ? stripped : titleFromPath(entry.pagePath);
}

/** Drop the trailing "### Links on this page" navigation block — pure boilerplate on every page. */
function stripNav(text: string): string {
  return text.split(/\n#{2,3} Links on this page/)[0]!.trim();
}

function progressLine(n: number, total: number, title: string, t: ItemTally): string {
  const kept = t.extracted - t.speculation;
  return (
    `[PROGRESS] (${n}/${total}) ${title} — extracted ${t.extracted} · ` +
    `spec ${t.speculation} dropped · kept ${kept} ` +
    `(skipped ${t.skipped} confident, checked ${t.notes + t.no_note + t.errors} → ` +
    `✍️ ${t.notes} notes · ✅ ${t.no_note} no-note · ❌ ${t.errors} err)`
  );
}

async function main() {
  const [dir, slug, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(" ");
  if (!dir || !slug || !name) {
    console.error('Usage: bun run src/everything/importFiles.ts <dir> <slug> <name...>');
    process.exit(1);
  }

  const { baseUrl, pages } = parseManifest(dir);
  const projectId = await upsertProject({ slug, name, description: `Imported from ${baseUrl}` });
  console.log(`Project "${name}" (${slug}) → ${pages.length} pages from ${baseUrl}\n`);

  const totals: ItemTally = { extracted: 0, speculation: 0, skipped: 0, notes: 0, no_note: 0, errors: 0 };
  for (let i = 0; i < pages.length; i++) {
    const entry = pages[i]!;
    const title = displayTitle(entry);
    const url = `${baseUrl}${entry.pagePath}`;
    console.log(`=== (${i + 1}/${pages.length}) ${title} — ${url}`);
    const item = await upsertItem({ project_id: projectId, source: "substack", url, title });
    try {
      await deleteClaimsForItem(item.id);
      const text = stripNav(fs.readFileSync(path.join(dir, entry.file), "utf8"));
      const content: FetchedContent = { kind: "substack", url, title, text };
      const tally = await processFetchedContent(item, content);
      await markItemDone(item.id);
      for (const k of Object.keys(totals) as (keyof ItemTally)[]) totals[k] += tally[k];
      console.log(progressLine(i + 1, pages.length, title, tally));
    } catch (err: any) {
      await markItemError(item.id, err?.message ?? "unknown");
      console.error(`[FAILED] (${i + 1}/${pages.length}) ${title}: ${err?.message}`);
    }
  }

  console.log(
    `\n[DONE] ${pages.length} pages · extracted ${totals.extracted} · spec ${totals.speculation} dropped · ` +
      `✍️ ${totals.notes} notes · ✅ ${totals.no_note} no-note · ⏭️ ${totals.skipped} confident · ❌ ${totals.errors} err`,
  );
  try {
    await closeBrowser();
  } catch {}
}

main().catch((err) => {
  console.error("[importFiles] Fatal error:", err);
  process.exit(1);
});
