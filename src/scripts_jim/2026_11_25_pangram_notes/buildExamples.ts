/**
 * Builds docs/pangram-note-examples.md, the examples the Pangram judge gets in
 * its system prompt (GOO-880): every Pangram note of July 2026 with its post
 * and the ratings it got in the public data. The input is the file fetch.ts
 * wrote.
 *
 *   bun run src/scripts_jim/2026_11_25_pangram_notes/buildExamples.ts <notes.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

type Row = {
  run: { tweet_id: string };
  tweet?: { text: string | null; author_name: string | null } | null;
  note?: { note_text: string; cn_status: string } | null;
  rating?: { helpful_count: number; somewhat_helpful_count: number; not_helpful_count: number; not_helpful_tag_counts: Record<string, number> | null } | null;
};

/** A reason must have been given this often to be listed. */
const MIN_REASON_COUNT = 2;
const TOP_REASONS = 3;
const OUT = path.resolve(import.meta.dir, "../../../docs/pangram-note-examples.md");

const READABLE_REASONS: Record<string, string> = {
  notHelpfulNoteNotNeeded: "note not needed",
  notHelpfulMissingKeyPoints: "missing key points",
  notHelpfulOpinionSpeculation: "opinion or speculation",
  notHelpfulSourcesMissingOrUnreliable: "sources missing or unreliable",
  notHelpfulIncorrect: "incorrect",
  notHelpfulArgumentativeOrBiased: "argumentative or biased",
  notHelpfulSpamHarassmentOrAbuse: "spam, harassment or abuse",
  notHelpfulIrrelevantSources: "irrelevant sources",
  notHelpfulHardToUnderstand: "hard to understand",
  notHelpfulOther: "other",
};

const rows: Row[] = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const submitted = rows.filter((r) => r.note && r.tweet?.text);
const ratingsOf = (r: Row) => r.rating ?? { helpful_count: 0, somewhat_helpful_count: 0, not_helpful_count: 0, not_helpful_tag_counts: null };
const total = (r: Row) => { const x = ratingsOf(r); return x.helpful_count + x.somewhat_helpful_count + x.not_helpful_count; };
submitted.sort((a, b) => total(b) - total(a));

function topReasons(r: Row): string {
  const tags = Object.entries(ratingsOf(r).not_helpful_tag_counts ?? {}).filter(([, n]) => n >= MIN_REASON_COUNT).sort((a, b) => b[1] - a[1]).slice(0, TOP_REASONS);
  return tags.length ? ` Most given reasons for not helpful: ${tags.map(([tag, n]) => `${READABLE_REASONS[tag] ?? tag} (${n})`).join(", ")}.` : "";
}

const examples = submitted.map((r, i) => {
  const x = ratingsOf(r);
  return `## Example ${i + 1}

Author: ${r.tweet!.author_name ?? "unknown"}

Post:
${r.tweet!.text!.trim().split("\n").map((line) => `> ${line}`).join("\n")}

Note: ${r.note!.note_text}

Ratings: ${x.helpful_count} helpful, ${x.somewhat_helpful_count} somewhat helpful, ${x.not_helpful_count} not helpful.${topReasons(r)}`;
});

writeFileSync(OUT, `# Pangram notes and how raters rated them

In July 2026 we wrote a Community Note on every long-form post that Pangram, an AI-text detector, called AI-generated. Below is each of those ${submitted.length} notes with its post and the ratings it got on X, most rated first. Together they got far more not-helpful ratings than helpful ones.

${examples.join("\n\n")}
`);
console.log(`Wrote ${submitted.length} examples to ${OUT}`);
