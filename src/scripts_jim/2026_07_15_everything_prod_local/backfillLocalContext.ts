/**
 * One-off: fill everything_claims.context_paragraph for the ai-2040 claims the
 * URL-based backfill (src/everything/backfillContextParagraph.ts) couldn't match
 * — table-row quotes that don't survive HTML→text linearisation. The local
 * import markdown in scratchpad/ai-2040 keeps those rows intact, so we match the
 * quote against those files instead of the fetched page.
 *
 *   bun run scratchpad/backfillLocalContext.ts
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getSupabaseClient } from "../../api/supabaseClient";

const LOCAL_DIR = path.join(import.meta.dir, "ai-2040");

const DRY_RUN = process.argv.includes("--dry-run");

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s: string): string[] => normalize(s).split(" ").filter((t) => t.length >= 3);

/** The paragraph/block (or block pair) of `text` that contains `quote` verbatim. */
function blockContaining(text: string, quote: string): string | null {
  const blocks = text.split("\n\n").map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean);
  const target = normalize(quote);
  const hit = blocks.find((b) => normalize(b).includes(target));
  if (hit) return hit;
  for (let i = 0; i < blocks.length - 1; i++) {
    if (normalize(`${blocks[i]} ${blocks[i + 1]}`).includes(target)) return `${blocks[i]}\n\n${blocks[i + 1]}`;
  }
  return null;
}

const MAX_WINDOW_LINES = 8;
const MIN_COVERAGE = 0.85;

/** Fallback for table/LaTeX quotes whose tokens are scattered across
 *  non-contiguous lines: the shortest run of ≤MAX_WINDOW_LINES consecutive lines
 *  that together cover ≥MIN_COVERAGE of the quote's distinctive tokens. */
function bestLineWindow(text: string, quote: string): { window: string; coverage: number } | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const want = new Set(tokens(quote));
  if (want.size === 0) return null;
  let best: { window: string; coverage: number; span: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const present = new Set<string>();
    for (let j = i; j < Math.min(lines.length, i + MAX_WINDOW_LINES); j++) {
      for (const t of tokens(lines[j]!)) if (want.has(t)) present.add(t);
      const coverage = present.size / want.size;
      const span = j - i + 1;
      if (coverage >= MIN_COVERAGE && (!best || span < best.span || (span === best.span && coverage > best.coverage))) {
        best = { window: lines.slice(i, j + 1).join("\n"), coverage, span };
        break; // shortest window from this start
      }
    }
  }
  return best && { window: best.window, coverage: best.coverage };
}

async function main() {
  const localTexts = fs
    .readdirSync(LOCAL_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => fs.readFileSync(path.join(LOCAL_DIR, f), "utf8"));

  const sb = getSupabaseClient();
  const { data: claims, error } = await sb
    .from("everything_claims")
    .select("id, context_quote")
    .eq("status", "note")
    .is("context_paragraph", null);
  if (error) throw error;
  if (!claims?.length) return console.log("Nothing to backfill.");

  let filled = 0;
  for (const claim of claims) {
    let paragraph = localTexts.map((t) => blockContaining(t, claim.context_quote)).find(Boolean) ?? null;
    // Table/LaTeX quotes have no contiguous source block; fall back to the best
    // consecutive-line window that covers the quote's tokens.
    if (!paragraph) {
      const windows = localTexts.map((t) => bestLineWindow(t, claim.context_quote)).filter(Boolean);
      paragraph = windows.sort((a, b) => b!.coverage - a!.coverage)[0]?.window ?? null;
    }
    if (!paragraph) {
      console.warn(`  ✗ no match: ${claim.context_quote.slice(0, 70)}…`);
      continue;
    }
    console.log(`\n  QUOTE: ${claim.context_quote}\n  PARA:  ${paragraph.replace(/\n/g, " ⏎ ")}\n`);
    if (!DRY_RUN) {
      const { error: updateError } = await sb
        .from("everything_claims")
        .update({ context_paragraph: paragraph })
        .eq("id", claim.id);
      if (updateError) throw updateError;
    }
    filled++;
  }
  console.log(`${DRY_RUN ? "[dry-run] would backfill" : "Backfilled"} ${filled}/${claims.length} from local files.`);
}

await main();
