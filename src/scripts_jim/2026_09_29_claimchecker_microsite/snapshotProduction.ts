/**
 * Copies the production run on this post into a lab run file, read-only. It
 * takes the item's claims, the notes on them (the pipeline's and the readers'),
 * each note's sources and vote counts, the readers' "note not needed"
 * arguments, and what every pipeline step cost. Run it again to pick up new
 * votes; it replaces the earlier copy.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/snapshotProduction.ts
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import type { ClaimOutcome, LabClaim, LabNote, LabVotes } from "./labRun";
import { saveRun } from "./runStore";

const PRODUCTION_ITEM_ID = "b5e5ff9c-8862-4b98-90bc-1e9ad0933f81";
/** A list of ids goes into the request URL, so long lists are sent in slices. */
const IDS_PER_REQUEST = 100;

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

function slices<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += IDS_PER_REQUEST) out.push(items.slice(i, i + IDS_PER_REQUEST));
  return out;
}

/** Runs one query per slice of ids and joins the rows. */
async function selectIn<Row>(ids: string[], query: (slice: string[]) => PromiseLike<{ data: Row[] | null; error: unknown }>): Promise<Row[]> {
  const rows: Row[] = [];
  for (const slice of slices(ids)) {
    const { data, error } = await query(slice);
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

function votesOf(row: { helpful_count: number; somewhat_helpful_count: number; not_helpful_count: number }): LabVotes {
  return { helpful: row.helpful_count, somewhatHelpful: row.somewhat_helpful_count, notHelpful: row.not_helpful_count };
}

function outcomeOf(status: string, reason: string | null): ClaimOutcome {
  switch (status) {
    case "note":
      return { type: "note" };
    case "no_note":
      return { type: "no_note", reason: reason ?? "" };
    case "skipped":
      return { type: "skipped", reason: reason ?? "" };
    case "error":
      return { type: "error", error: reason ?? "" };
    default:
      return { type: "unchecked" };
  }
}

async function main() {
  const { data: item, error } = await db.from("everything_items").select("id, title, started_at").eq("id", PRODUCTION_ITEM_ID).single();
  if (error) throw error;
  const { data: claims, error: claimsError } = await db
    .from("everything_claims")
    .select("id, claim, context_quote, context_paragraph, image_urls, judgement, status, status_reason")
    .eq("item_id", PRODUCTION_ITEM_ID)
    .order("created_at");
  if (claimsError) throw claimsError;
  const claimIds = claims!.map((c) => c.id);

  const notes = await selectIn(claimIds, (slice) =>
    db
      .from("everything_notes")
      .select("id, claim_id, note, author_id, author_name, status, created_at, improved_from_note_id, helpful_count, somewhat_helpful_count, not_helpful_count, everything_note_sources(url, quote, explanation, sort_order)")
      .in("claim_id", slice),
  );
  const notNeeded = await selectIn(claimIds, (slice) =>
    db.from("everything_note_not_needed").select("id, claim_id, body, author_name, helpful_count, somewhat_helpful_count, not_helpful_count").in("claim_id", slice),
  );
  const claimRuns = await selectIn(claimIds, (slice) => db.from("everything_pipeline_runs").select("claim_id, cost").in("claim_id", slice));
  const { data: itemRuns, error: runsError } = await db.from("everything_pipeline_runs").select("kind, cost").eq("item_id", PRODUCTION_ITEM_ID);
  if (runsError) throw runsError;

  const labNotes = new Map<string, LabNote[]>();
  for (const n of notes) {
    const sources = [...n.everything_note_sources]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ url, quote, explanation }) => ({ url, quote, explanation }));
    const note: LabNote = {
      id: n.id,
      text: n.note,
      author: n.author_id ? (n.author_name ?? "anonymous") : null,
      isAi: !n.author_id,
      sources,
      votes: votesOf(n),
      status: n.status,
      createdAt: n.created_at,
      improvedFromNoteId: n.improved_from_note_id,
    };
    labNotes.set(n.claim_id, [...(labNotes.get(n.claim_id) ?? []), note]);
  }
  const checkCost = new Map<string, number>();
  for (const r of claimRuns) checkCost.set(r.claim_id!, (checkCost.get(r.claim_id!) ?? 0) + Number(r.cost ?? 0));
  const itemCost = (kind: string) => itemRuns!.filter((r) => r.kind === kind).reduce((sum, r) => sum + Number(r.cost ?? 0), 0);

  const labClaims: LabClaim[] = claims!.map((c) => ({
    id: c.id,
    claim: c.claim,
    contextQuote: c.context_quote,
    contextParagraph: c.context_paragraph,
    imageUrls: (c.image_urls as string[] | null) ?? [],
    judgement: c.judgement,
    part: null,
    outcome: outcomeOf(c.status, c.status_reason),
    notes: labNotes.get(c.id) ?? [],
    notNeeded: notNeeded
      .filter((e) => e.claim_id === c.id)
      .map((e) => ({ id: e.id, body: e.body, author: e.author_name, votes: votesOf(e) })),
    checkCostUsd: checkCost.get(c.id) ?? null,
  }));

  saveRun({
    id: "production",
    label: "Production, 24 Sep (with reader notes and votes)",
    createdAt: item!.started_at!,
    source: "production",
    commit: null,
    basedOn: null,
    costUsd: {
      extraction: itemCost("extraction"),
      rating: itemCost("rating"),
      checks: [...checkCost.values()].reduce((a, b) => a + b, 0),
    },
    claims: labClaims,
  });
  const readerNotes = notes.filter((n) => n.author_id).length;
  console.log(`Production: ${labClaims.length} claims, ${notes.length - readerNotes} AI notes, ${readerNotes} reader notes`);
}

await main();
