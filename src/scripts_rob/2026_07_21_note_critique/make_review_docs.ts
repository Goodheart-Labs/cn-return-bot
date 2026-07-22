/**
 * Turn corpus.json into two annotation-ready markdown docs for Rob's manual
 * critique pass (both gitignored — verbatim tweet text stays local):
 *
 *   WINNERS_REVIEW.md — the 7 ecosystem notes that reached Helpful, one by one,
 *     each with a blank "What worked" slot. Appendix: the 7 rated Not Helpful.
 *   OURS_REVIEW.md    — our 14 submitted notes with their post + outcome,
 *     each with a blank "What I'd change" slot.
 *
 *   bun run src/scripts_rob/2026_07_21_note_critique/make_review_docs.ts
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DIR = "src/scripts_rob/2026_07_21_note_critique";

// Rob hand-annotates the generated docs — never silently overwrite them.
const FORCE = process.argv.includes("--force");
if (!FORCE && (existsSync(`${DIR}/WINNERS_REVIEW.md`) || existsSync(`${DIR}/OURS_REVIEW.md`))) {
  console.error("Review docs already exist (and may hold hand-written annotations). Rerun with --force to overwrite.");
  process.exit(1);
}

interface EcoNote {
  noteId: string; tweetId: string; status?: string;
  summary: string; tweetText: string; hoursToStatus: number | null;
}
interface OurNote {
  noteId: string; tweetId: string; text: string; tweetText: string | null;
  status: string | null; ratingCount: number | null; helpful: number;
  notHelpful: number; views: number | null; submittedAt: string;
}
const raw = JSON.parse(readFileSync(`${DIR}/corpus.json`, "utf8")) as {
  ours: OurNote[]; shown: EcoNote[]; notHelpful: EcoNote[];
};

// Known topical-classifier over-matches, hand-checked 7/21 — not speech-topic,
// so useless for "how to write better in OUR category". Dropped from the docs.
const OFF_TOPIC = new Set([
  "2072241845933891762", // KIDS Act / Big Tech lobbying
  "2072223139837190425", // KIDS Act / age verification
  "2068073354192400514", // Walz impeachment (MN welfare-fraud politics)
  "2070675535592869974", // Venezuela / Delcy Rodríguez
  "2076933746696036532", // Venezuela / Maduro
]);
const corpus = {
  ours: raw.ours,
  shown: raw.shown.filter((n) => !OFF_TOPIC.has(n.noteId)),
  notHelpful: raw.notHelpful.filter((n) => !OFF_TOPIC.has(n.noteId)),
};

const decode = (s: string) => s
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
  .replace(/&gt;/g, ">").replace(/&lt;/g, "<");
const quote = (s: string) =>
  decode(s).trim().split(/\n+/).map((l) => `> ${l.trim()}`).join("\n> \n");
const urls = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const domains = (s: string) => [...new Set(urls(s).map((u) => {
  try { return new URL(decode(u)).hostname.replace(/^www\./, ""); } catch { return null; }
}).filter(Boolean))].join(", ");
const meta = (text: string) =>
  `*${decode(text).length} chars · ${urls(text).length} URL${urls(text).length === 1 ? "" : "s"}${domains(text) ? ` · ${domains(text)}` : ""}*`;

function ecoEntry(n: EcoNote, id: string, verdictLine: string, slot: string): string {
  return [
    `## ${id} — ${verdictLine}`,
    ``,
    `**Tweet:** https://x.com/i/web/status/${n.tweetId}`,
    ``,
    `**Post:**`,
    n.tweetText.trim() ? quote(n.tweetText) : `> *(tweet text not captured)*`,
    ``,
    `**Note:**`,
    quote(n.summary),
    ``,
    meta(n.summary),
    ``,
    `**${slot}**`,
    ``,
    `- `,
    ``,
    `---`,
    ``,
  ].join("\n");
}

// ── WINNERS_REVIEW.md ────────────────────────────────────────────────────────
const shown = [...corpus.shown].sort((a, b) => (a.hoursToStatus ?? 1e9) - (b.hoursToStatus ?? 1e9));
const winnersDoc = [
  `# Winners review — ecosystem notes on this topic that reached Helpful`,
  ``,
  `One entry per note, fastest first. Write what you think made it work under`,
  `each. Known off-topic over-matches (KIDS Act ×2, Walz) are already filtered`,
  `out — every entry here is genuinely on the speech topic.`,
  ``,
  `---`,
  ``,
  ...shown.map((n, i) => ecoEntry(
    n, `W${i + 1}`,
    n.hoursToStatus !== null ? `Helpful in ${n.hoursToStatus.toFixed(1)}h` : `Helpful`,
    "What worked:")),
  `# Appendix — rated NOT Helpful (the failure mode with a verdict)`,
  ``,
  `Optional pass. These are the only notes raters actively rejected.`,
  ``,
  `---`,
  ``,
  ...corpus.notHelpful.map((n, i) => ecoEntry(n, `N${i + 1}`, `Not Helpful`, "Why it failed (optional):")),
].join("\n");
writeFileSync(`${DIR}/WINNERS_REVIEW.md`, winnersDoc);

// ── OURS_REVIEW.md ───────────────────────────────────────────────────────────
const statusRank = (s: string | null) =>
  s === "CURRENTLY_RATED_HELPFUL" ? 0 : s === "CURRENTLY_RATED_NOT_HELPFUL" ? 1 : 2;
const ours = [...corpus.ours].sort((a, b) =>
  statusRank(a.status) - statusRank(b.status) || a.submittedAt.localeCompare(b.submittedAt));
const oursDoc = [
  `# Our notes review — the ${ours.length} bot notes submitted on topic-sighted tweets`,
  ``,
  `Sorted decided-first, then oldest-first. Ratings/views lag (~2-day public`,
  `dump; scraper cn_status is fresher) — treat 0s on recent notes as "not yet".`,
  `Write what you'd change under each.`,
  ``,
  `---`,
  ``,
  ...ours.map((n, i) => [
    `## O${i + 1} — submitted ${n.submittedAt.slice(0, 16).replace("T", " ")}`,
    ``,
    `**Tweet:** https://x.com/i/web/status/${n.tweetId}`,
    ``,
    `status **${n.status ?? "—"}** · ratings ${n.ratingCount ?? 0} (${n.helpful} helpful / ${n.notHelpful} not) · views ${n.views ?? "—"}`,
    ``,
    `**Post:**`,
    n.tweetText?.trim() ? quote(n.tweetText) : `> *(no tweets row)*`,
    ``,
    `**Note:**`,
    quote(n.text),
    ``,
    meta(n.text),
    ``,
    `**What I'd change:**`,
    ``,
    `- `,
    ``,
    `---`,
    ``,
  ].join("\n")),
].join("\n");
writeFileSync(`${DIR}/OURS_REVIEW.md`, oursDoc);

console.log(`wrote ${DIR}/WINNERS_REVIEW.md (${shown.length} winners + ${corpus.notHelpful.length} not-helpful)`);
console.log(`wrote ${DIR}/OURS_REVIEW.md (${ours.length} notes)`);
