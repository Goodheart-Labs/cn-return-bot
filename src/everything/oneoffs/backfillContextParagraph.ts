/**
 * Backfill everything_claims.context_paragraph — the wider verbatim window the
 * claim's context_quote sits in — by re-fetching each item's source content:
 *
 *   - youtube: transcript cues overlapping [start_seconds − PAD, end_seconds + PAD]
 *   - anything else: fetch the page, split to text blocks, find the block
 *     (or consecutive block pair) containing the quote
 *
 * Only claims with a written note (status = 'note') and no paragraph yet are
 * touched, so re-runs are cheap and idempotent.
 *
 *   bun run src/everything/backfillContextParagraph.ts
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import { getSupabaseClient } from "../../api/supabaseClient";
import { fetchTimedTranscript, type SubtitleCue } from "../../pipeline/media/ytDlpDownload";
import { htmlToText } from "../sources/substack";

const PAD_SECONDS = 30;

/** Comparison form: lowercase, punctuation-insensitive, whitespace-collapsed. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function transcriptWindow(cues: SubtitleCue[], start: number, end: number): string | null {
  const window = cues.filter((c) => c.end >= start - PAD_SECONDS && c.start <= end + PAD_SECONDS);
  if (window.length === 0) return null;
  // Rolling auto-captions repeat lines across cues; drop consecutive duplicates.
  const parts: string[] = [];
  for (const cue of window) {
    const text = cue.text.replace(/\s+/g, " ").trim();
    if (text && text !== parts[parts.length - 1]) parts.push(text);
  }
  return parts.length > 0 ? `… ${parts.join(" ")} …` : null;
}

function blockContaining(text: string, quote: string): string | null {
  const blocks = text.split("\n\n").map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean);
  const target = normalize(quote);
  const hit = blocks.find((b) => normalize(b).includes(target));
  if (hit) return hit;
  // The quote may straddle a block boundary.
  for (let i = 0; i < blocks.length - 1; i++) {
    if (normalize(`${blocks[i]} ${blocks[i + 1]}`).includes(target)) return `${blocks[i]}\n\n${blocks[i + 1]}`;
  }
  // Last resort: match on the quote's opening words (transcription drift).
  const prefix = normalize(quote.split(/\s+/).slice(0, 8).join(" "));
  return blocks.find((b) => normalize(b).includes(prefix)) ?? null;
}

async function main() {
  const sb = getSupabaseClient();
  const { data: claims, error } = await sb
    .from("everything_claims")
    .select("id, item_id, context_quote, start_seconds, end_seconds")
    .eq("status", "note")
    .is("context_paragraph", null);
  if (error) throw error;
  if (!claims || claims.length === 0) return console.log("Nothing to backfill.");

  const { data: items } = await sb.from("everything_items").select("id, url");
  const urlByItem = new Map((items ?? []).map((i) => [i.id, i.url]));
  const byItem = Map.groupBy(claims, (c) => c.item_id);
  let filled = 0;

  for (const [itemId, itemClaims] of byItem) {
    const url = urlByItem.get(itemId);
    if (!url) continue;
    const isYoutube = /youtube\.com|youtu\.be/.test(url);

    let cues: SubtitleCue[] | null = null;
    let pageText: string | null = null;
    if (isYoutube) {
      const dir = fs.mkdtempSync(path.join(tmpdir(), "cn-backfill-"));
      try {
        cues = fetchTimedTranscript(url, dir, "en");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      if (!cues) console.warn(`no transcript for ${url}`);
    } else {
      try {
        pageText = htmlToText(await (await fetch(url)).text());
      } catch (e) {
        console.warn(`fetch failed for ${url}: ${e}`);
      }
    }

    for (const claim of itemClaims) {
      const paragraph =
        isYoutube && cues && claim.start_seconds != null
          ? transcriptWindow(cues, claim.start_seconds, claim.end_seconds ?? claim.start_seconds)
          : pageText
            ? blockContaining(pageText, claim.context_quote)
            : null;
      if (!paragraph) {
        console.warn(`  no paragraph: ${claim.context_quote.slice(0, 60)}…`);
        continue;
      }
      const { error: updateError } = await sb
        .from("everything_claims")
        .update({ context_paragraph: paragraph })
        .eq("id", claim.id);
      if (updateError) throw updateError;
      filled++;
      console.log(`  ✓ ${claim.context_quote.slice(0, 60)}…`);
    }
  }
  console.log(`Backfilled ${filled}/${claims.length} claims.`);
}

await main();
