/**
 * Lists the posts, videos and pages where the Common Notes pipeline wrote notes
 * recently, so the minisite finder can see which of them would make a good
 * minisite. An item that already has a minisite says so.
 *
 *   bun run noted-items                 # items processed in the last 3 days
 *   bun run noted-items --days 7
 *   bun run noted-items --notes         # also print every AI note with the quote it is about
 *   bun run noted-items --json          # machine-readable output
 *
 * It reads the production database through SUPABASE_URL and SUPABASE_SERVICE_KEY.
 */

import { getSupabaseClient } from "../api/supabaseClient";
import { fetchAllRows, fetchInBatches } from "../everything-core/paging";

const DEFAULT_DAYS = 3;
const DAY_MS = 86_400_000;
const SITE = "https://commonnotes.net";

type ItemRow = { id: string; url: string; title: string | null; published_at: string | null; processed_at: string; project_id: string | null };
type ClaimRow = { id: string; item_id: string; claim: string; context_quote: string | null; judgement: string };
type NoteRow = { id: string; claim_id: string; note: string; helpful_count: number; somewhat_helpful_count: number; not_helpful_count: number };
type NotedItem = {
  title: string;
  url: string;
  publishedAt: string | null;
  processedAt: string;
  project: string;
  siteUrl: string;
  minisiteUrl: string | null;
  votes: number;
  notes: { claim: string; quote: string | null; judgement: string; note: string }[];
};

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function fetchProcessedItems(since: string): Promise<ItemRow[]> {
  const db = getSupabaseClient();
  return fetchAllRows<ItemRow>(
    () =>
      db
        .from("everything_items")
        .select("id, url, title, published_at, processed_at, project_id")
        .eq("status", "done")
        .gte("processed_at", since),
    "id",
    { label: "noted items" },
  );
}

async function fetchNotedClaims(itemIds: string[]): Promise<ClaimRow[]> {
  const db = getSupabaseClient();
  return fetchInBatches<ClaimRow>(
    (chunk) => db.from("everything_claims").select("id, item_id, claim, context_quote, judgement").eq("status", "note").in("item_id", chunk),
    itemIds,
    "id",
    { label: "noted claims" },
  );
}

/** Only the pipeline's own notes count. A reader's note has an author. */
async function fetchAiNotes(claimIds: string[]): Promise<NoteRow[]> {
  const db = getSupabaseClient();
  return fetchInBatches<NoteRow>(
    (chunk) =>
      db
        .from("everything_notes")
        .select("id, claim_id, note, helpful_count, somewhat_helpful_count, not_helpful_count")
        .is("author_id", null)
        .in("claim_id", chunk),
    claimIds,
    "id",
    { label: "AI notes" },
  );
}

async function fetchProjectSlugs(): Promise<Map<string, string>> {
  const rows = await fetchAllRows<{ id: string; slug: string }>(
    () => getSupabaseClient().from("everything_projects").select("id, slug"),
    "id",
    { label: "projects" },
  );
  return new Map(rows.map((row) => [row.id, row.slug]));
}

async function fetchMinisiteSlugs(itemIds: string[]): Promise<Map<string, string>> {
  const db = getSupabaseClient();
  const rows = await fetchInBatches<{ id: string; item_id: string; slug: string }>(
    (chunk) => db.from("everything_minisites").select("id, item_id, slug").in("item_id", chunk),
    itemIds,
    "id",
    { label: "minisites" },
  );
  return new Map(rows.map((row) => [row.item_id, row.slug]));
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}

async function findNotedItems(days: number): Promise<NotedItem[]> {
  const items = await fetchProcessedItems(new Date(Date.now() - days * DAY_MS).toISOString());
  const claims = await fetchNotedClaims(items.map((item) => item.id));
  const notes = await fetchAiNotes(claims.map((claim) => claim.id));
  const notedItemIds = [...new Set(claims.map((claim) => claim.item_id))];
  const [projectSlugs, minisiteSlugs] = await Promise.all([fetchProjectSlugs(), fetchMinisiteSlugs(notedItemIds)]);

  const notesByClaim = groupBy(notes, (note) => note.claim_id);
  const claimsByItem = groupBy(claims, (claim) => claim.item_id);
  return items
    .filter((item) => claimsByItem.has(item.id))
    .map((item) => {
      const project = (item.project_id && projectSlugs.get(item.project_id)) || "web";
      const minisite = minisiteSlugs.get(item.id);
      const itemNotes = claimsByItem.get(item.id)!.flatMap((claim) =>
        (notesByClaim.get(claim.id) ?? []).map((note) => ({ claim, note })),
      );
      return {
        title: item.title ?? item.url,
        url: item.url,
        publishedAt: item.published_at,
        processedAt: item.processed_at,
        project,
        siteUrl: `${SITE}/notes/${project}/${item.id}`,
        minisiteUrl: minisite ? `${SITE}/minisites/${minisite}` : null,
        votes: itemNotes.reduce((sum, { note }) => sum + note.helpful_count + note.somewhat_helpful_count + note.not_helpful_count, 0),
        notes: itemNotes.map(({ claim, note }) => ({ claim: claim.claim, quote: claim.context_quote, judgement: claim.judgement, note: note.note })),
      };
    })
    .sort((a, b) => b.processedAt.localeCompare(a.processedAt));
}

function formatItem(item: NotedItem, withNotes: boolean): string {
  const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "?");
  const lines = [
    `## ${item.title}`,
    `${item.url}`,
    `project ${item.project}, published ${date(item.publishedAt)}, checked ${date(item.processedAt)}, ${item.notes.length} AI notes, ${item.votes} votes`,
    `notes: ${item.siteUrl}${item.minisiteUrl ? `\nMINISITE EXISTS: ${item.minisiteUrl}` : ""}`,
  ];
  if (withNotes) {
    for (const note of item.notes) {
      lines.push("", `- Quote: ${note.quote ?? "(image)"}`, `  Claim (${note.judgement}): ${note.claim}`, `  Note: ${note.note.replace(/\n+/g, " ")}`);
    }
  }
  return lines.join("\n");
}

const days = Number(readFlag("--days") ?? DEFAULT_DAYS);
const notedItems = await findNotedItems(days);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(notedItems, null, 2));
} else {
  console.log(`${notedItems.length} items with AI notes, processed in the last ${days} days, newest first\n`);
  console.log(notedItems.map((item) => formatItem(item, process.argv.includes("--notes"))).join("\n\n"));
}
