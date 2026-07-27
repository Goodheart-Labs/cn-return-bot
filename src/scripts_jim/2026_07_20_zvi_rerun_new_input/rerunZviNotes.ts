/**
 * Re-run every Zvi-project note through the NEW fact-check input (commit
 * 57cb0b6: verbatim highlighted span + surrounding paragraph, not Opus's
 * paraphrase) and dump the old-vs-new pairs to results.json.
 *
 * READ-ONLY against prod: reads everything_projects/items/claims/notes/
 * note_sources, writes nothing back. The rerun goes through the exact same
 * `checkClaim` the worker uses, so it reflects the current input. Results are
 * saved locally only.
 *
 *   bun run src/scripts_jim/2026_07_20_zvi_rerun_new_input/rerunZviNotes.ts [--slug <slug>] [--limit N]
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import PQueue from "p-queue";
import { getSupabaseClient } from "../../api/supabaseClient";
import { checkClaim } from "../../everything/pipeline/checkClaims";
import { closeBrowser } from "../../pipeline/utils/browserManager";
import type { ClaimCheck, ExtractedClaim, NoteSourceCitation, SourceKind } from "../../everything/types";

const CHECK_CONCURRENCY = 4;
const OUT_FILE = path.join(__dirname, "results.json");

function parseArgs() {
  const args = process.argv.slice(2);
  const slugIdx = args.indexOf("--slug");
  const limitIdx = args.indexOf("--limit");
  const claimsIdx = args.indexOf("--claims");
  const outIdx = args.indexOf("--out");
  return {
    slug: slugIdx !== -1 ? args[slugIdx + 1] : undefined,
    limit: limitIdx !== -1 ? Number(args[limitIdx + 1]) : undefined,
    // Comma-separated claim ids (full or 8-char prefix) to restrict the rerun to.
    claimFilter: claimsIdx !== -1 ? args[claimsIdx + 1]!.split(",").map((s) => s.trim()) : undefined,
    outFile: outIdx !== -1 ? path.resolve(args[outIdx + 1]!) : OUT_FILE,
  };
}

interface ItemRow {
  id: string;
  source: SourceKind;
  published_at: string | null;
  title: string | null;
  url: string;
}
interface ClaimRow {
  id: string;
  item_id: string;
  claim: string;
  judgement: string;
  context_quote: string | null;
  context_paragraph: string | null;
  context_url: string | null;
  image_urls: string[] | null;
}
interface NoteRow {
  id: string;
  claim_id: string;
  note: string;
}
interface SourceRow {
  note_id: string;
  url: string;
  quote: string | null;
  explanation: string | null;
  sort_order: number;
}

/** Result entry per Zvi note: everything the classifier + overview need. */
interface RerunResult {
  claimId: string;
  itemTitle: string | null;
  itemUrl: string;
  contextUrl: string | null;
  claim: string; // Opus's paraphrase (context only; not fed to the new input)
  highlighted: string; // context_quote — the verbatim highlighted span
  paragraph: string; // context_paragraph — the surrounding passage
  oldNote: string;
  oldSources: NoteSourceCitation[];
  newOutcome: ClaimCheck;
}

const db = getSupabaseClient();

/** Fetch every row matching a filtered select, paging past PostgREST's 1000 cap. */
async function fetchAll<T>(table: string, columns: string, apply: (q: any) => any): Promise<T[]> {
  const rows: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await apply(db.from(table).select(columns)).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function resolveZviProject(slugOverride?: string): Promise<{ id: string; slug: string; name: string }> {
  const projects = (await db.from("everything_projects").select("id, slug, name")).data as
    | { id: string; slug: string; name: string }[]
    | null;
  if (!projects?.length) throw new Error("no everything_projects rows");
  console.log(`projects: ${projects.map((p) => p.slug).join(", ")}`);
  const match = slugOverride
    ? projects.find((p) => p.slug === slugOverride)
    : projects.find((p) => /zvi/i.test(p.slug) || /zvi/i.test(p.name));
  if (!match) throw new Error(`no Zvi project found (override=${slugOverride ?? "none"})`);
  console.log(`→ using project "${match.name}" (slug=${match.slug}, id=${match.id})`);
  return match;
}

/** Only the three context fields are read by buildClaimPost; the rest satisfy the type. */
function toExtractedClaim(c: ClaimRow): ExtractedClaim {
  return {
    claim: c.claim,
    judgement: c.judgement,
    context: c.context_quote ?? "",
    contextParagraph: c.context_paragraph ?? "",
    imageUrls: c.image_urls ?? [],
    speculation: false,
    anchor: { kind: "substack", url: c.context_url ?? "" },
  };
}

async function main() {
  const { slug, limit, claimFilter, outFile } = parseArgs();
  const project = await resolveZviProject(slug);

  const items = await fetchAll<ItemRow>("everything_items", "id, source, published_at, title, url", (q) =>
    q.eq("project_id", project.id),
  );
  const itemById = new Map(items.map((i) => [i.id, i]));
  console.log(`items: ${items.length}`);

  const itemIds = items.map((i) => i.id);
  let claims = itemIds.length
    ? await fetchAll<ClaimRow>(
        "everything_claims",
        "id, item_id, claim, judgement, context_quote, context_paragraph, context_url, image_urls",
        (q) => q.in("item_id", itemIds).eq("status", "note").order("created_at"),
      )
    : [];
  console.log(`claims with a note: ${claims.length}`);
  if (claimFilter) {
    claims = claims.filter((c) => claimFilter.some((f) => c.id === f || c.id.startsWith(f)));
    console.log(`--claims → ${claims.length} claims`);
  }
  if (limit) {
    claims = claims.slice(0, limit);
    console.log(`--limit ${limit} → ${claims.length} claims`);
  }

  const claimIds = claims.map((c) => c.id);
  // The AI note is the author-less published row (user drafts have author_id + status='draft').
  const notes = claimIds.length
    ? await fetchAll<NoteRow>("everything_notes", "id, claim_id, note", (q) =>
        q.in("claim_id", claimIds).is("author_id", null).eq("status", "published"),
      )
    : [];
  const noteByClaim = new Map(notes.map((n) => [n.claim_id, n]));
  const noteIds = notes.map((n) => n.id);
  const sources = noteIds.length
    ? await fetchAll<SourceRow>("everything_note_sources", "note_id, url, quote, explanation, sort_order", (q) =>
        q.in("note_id", noteIds).order("sort_order"),
      )
    : [];
  const sourcesByNote = new Map<string, NoteSourceCitation[]>();
  for (const s of sources) {
    if (!sourcesByNote.has(s.note_id)) sourcesByNote.set(s.note_id, []);
    sourcesByNote.get(s.note_id)!.push({ url: s.url, quote: s.quote, explanation: s.explanation });
  }

  console.log(`\nrerunning ${claims.length} claims (concurrency ${CHECK_CONCURRENCY})…\n`);
  const results: RerunResult[] = [];
  let done = 0;
  const queue = new PQueue({ concurrency: CHECK_CONCURRENCY });
  claims.forEach((claim, index) => {
    const item = itemById.get(claim.item_id)!;
    const oldNote = noteByClaim.get(claim.id);
    queue.add(async () => {
      const newOutcome = await checkClaim({
        claim: toExtractedClaim(claim),
        source: item.source,
        itemId: item.id,
        index,
        publishedAt: item.published_at ?? undefined,
      });
      results.push({
        claimId: claim.id,
        itemTitle: item.title,
        itemUrl: item.url,
        contextUrl: claim.context_url,
        claim: claim.claim,
        highlighted: claim.context_quote ?? "",
        paragraph: claim.context_paragraph ?? "",
        oldNote: oldNote?.note ?? "",
        oldSources: oldNote ? (sourcesByNote.get(oldNote.id) ?? []) : [],
        newOutcome,
      });
      done++;
      const tag = newOutcome.kind === "note" ? "NOTE" : `no note (${newOutcome.reason ?? newOutcome.outcome})`;
      console.log(`  [${done}/${claims.length}] ${tag} — ${claim.claim.slice(0, 80)}`);
    });
  });
  await queue.onIdle();

  results.sort((a, b) => claimIds.indexOf(a.claimId) - claimIds.indexOf(b.claimId));
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  const gotNote = results.filter((r) => r.newOutcome.kind === "note").length;
  console.log(`\ndone — ${results.length} results (${gotNote} note, ${results.length - gotNote} no_note) → ${outFile}`);
}

main()
  .catch((err) => {
    console.error("[rerunZviNotes] Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeBrowser();
    } catch {}
  });
