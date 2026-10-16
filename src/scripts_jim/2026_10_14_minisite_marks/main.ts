// Compares, for one minisite, where the reader places each margin card with
// which quotes it can actually underline. Usage: bun run <this file> <title words>
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { findQuoteMarks, mapQuotesToBlocks, parseReaderText, runsText, type ReaderBlock } from "../../everything-core/readerText";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const titleWords = process.argv.slice(2).join(" ") || "Claude have rights";

const { data: sites, error } = await db.from("everything_minisites").select("id, slug, title, item_id, content, features").ilike("title", `%${titleWords}%`);
if (error) throw error;
const site = sites[0]!;
console.log(`${site.slug}: ${site.title}\nfeatures: ${site.features.join(", ")}\n`);

const { data: claims, error: claimError } = await db.from("everything_claims")
  .select("id, context_quote, context_paragraph, updated_quote, everything_notes(id, status)")
  .eq("item_id", site.item_id);
if (claimError) throw claimError;
const notes = claims.flatMap((claim) => claim.everything_notes.filter((note) => note.status !== "hidden").map(() => ({ kind: "note", quote: claim.updated_quote ?? claim.context_quote, anchor: claim })));
const { data: highlights, error: highlightError } = await db.from("everything_passage_highlights").select("kind, quote, context_paragraph, statement").eq("item_id", site.item_id);
if (highlightError) throw highlightError;
const entries = [...notes, ...highlights.map((h) => ({ kind: h.kind, quote: h.quote, anchor: { context_quote: h.quote, context_paragraph: h.context_paragraph } }))];

const blocks = parseReaderText(site.content);
const placed = mapQuotesToBlocks(blocks, entries, (entry) => entry.anchor);

const blockText = (block: ReaderBlock): string[] => {
  if (block.kind === "list") return block.items.map(runsText);
  if ("runs" in block) return [runsText(block.runs)];
  if (block.kind === "figure") return [runsText(block.caption)];
  return [];
};

let cards = 0;
let marked = 0;
for (const block of blocks) {
  const group = placed.byBlock.get(block.id);
  if (!group) continue;
  const texts = blockText(block);
  console.log(`--- ${block.id} (${block.kind}): ${block.text.slice(0, 90)}...`);
  for (const entry of group) {
    cards++;
    const marks = texts.flatMap((text) => findQuoteMarks(text, [{ quote: entry.quote ?? "", kind: entry.kind, key: entry.kind }]));
    if (marks.length) marked++;
    console.log(`  [${marks.length ? "underlined" : "NO MARK   "}] ${entry.kind}: ${JSON.stringify(entry.quote)}`);
  }
}
console.log(`\nunanchored: ${placed.unanchored.length}`);
for (const entry of placed.unanchored) console.log(`  ${entry.kind}: ${JSON.stringify(entry.quote)}`);
console.log(`\n${cards} cards beside passages, ${marked} of them with an underline`);
