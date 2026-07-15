/**
 * Dump the ai-2040 project's claims + notes from the DB into one JSON per page,
 * named after the source markdown file: scratchpad/ai-2040/<base>.claims.json.
 * Re-runnable — picks up whatever the import has written so far.
 *
 *   bun run scratchpad/dumpClaimsJson.ts
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getSupabaseClient } from "../../api/supabaseClient";

const DIR = "scratchpad/ai-2040";
const SLUG = "ai-2040";

const db = getSupabaseClient();

const readme = fs.readFileSync(path.join(DIR, "README.md"), "utf8");
const baseUrl = readme.match(/Source:\s*(https?:\/\/[^\s·]+)/)?.[1]?.replace(/\/$/, "")!;
const pages: { file: string; pagePath: string }[] = [];
for (const line of readme.split("\n")) {
  const m = line.match(/^- \[(.+?)\]\((.+?\.md)\) — `(.+?)`/);
  if (m) pages.push({ file: m[2]!, pagePath: m[3]! });
}

const { data: project } = await db.from("everything_projects").select("id").eq("slug", SLUG).single();
if (!project) throw new Error(`project ${SLUG} not found`);
const { data: items } = await db
  .from("everything_items")
  .select("id, url, title, status")
  .eq("project_id", project.id);
const itemByUrl = new Map((items ?? []).map((i) => [i.url, i]));

for (const page of pages) {
  const item = itemByUrl.get(`${baseUrl}${page.pagePath}`);
  if (!item) {
    console.log(`— ${page.file}: no item in DB yet`);
    continue;
  }
  const { data: claims } = await db
    .from("everything_claims")
    .select("id, claim, judgement, context_quote, context_url, status, status_reason")
    .eq("item_id", item.id)
    .order("created_at");
  const claimIds = (claims ?? []).map((c) => c.id);
  const { data: notes } = claimIds.length
    ? await db.from("everything_notes").select("claim_id, note, sources").in("claim_id", claimIds)
    : { data: [] };
  const noteByClaim = new Map((notes ?? []).map((n) => [n.claim_id, n]));

  const rows = (claims ?? []).map((c) => ({
    claim: c.claim,
    judgement: c.judgement,
    context: c.context_quote,
    contextUrl: c.context_url,
    status: c.status,
    statusReason: c.status_reason,
    note: noteByClaim.get(c.id)?.note ?? null,
    sources: noteByClaim.get(c.id)?.sources ?? null,
  }));
  const outPath = path.join(DIR, page.file.replace(/\.md$/, ".claims.json"));
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
  console.log(`${outPath} — ${rows.length} claims (item ${item.status})`);
}
