/**
 * Not-Helpful deep dive, analysis 2 (data collection) — stream the public
 * dump's ratings partitions and keep every rating on (a) our topic notes and
 * (b) ecosystem election notes since 2026-06-18 (same predicates as
 * export_precedents: strict = live topic predicate on note text, broad =
 * wider election regex). Also tallies every rater's global h/s/n counts so
 * the analysis can separate "selective rejecter of our notes" from "serial
 * downvoter of everything" — the tally is written filtered to raters who
 * rated OUR notes.
 *
 * The ratings files are keyed by NOTE id (7/22 lesson) and are ZIP64 —
 * funzip silently dies on them; bsdtar streams them fine. Each shard is
 * streamed from the network (curl | bsdtar -xOf -), nothing big lands on
 * disk.
 *
 * Outputs (in this dir; raw data gitignored):
 *   targets.json              — note-id sets + tier/status metadata
 *   target_ratings.tsv        — kept rows, "HEADER\t<hdr>" then "<part>\t<row>"
 *                               (same format add_eco_rater_reasons consumes)
 *   rater_global_tallies.json — raterId → {h,s,n} for raters on our notes
 *
 *   bun run src/scripts_rob/2026_07_24_not_helpful_deep_dive/collect_ratings.ts
 */

import { createWriteStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";
import { SupabaseLogger } from "../../api/supabaseClient";
import { forEachTsvRow } from "../dashboard_exports/tsv";

const TOPIC_ID = "trump_election_security";
const WINDOW_START = Date.parse("2026-06-18T00:00:00Z");
const CN_DATA_BASE_URL = "https://ton.twimg.com/birdwatch-public-data";
const DUMP_DIR = "./cn-data";
const DIR = import.meta.dir;
const MAX_DAYS_BACK = 7;

const topic = MISINFO_TOPICS.find((t) => t.id === TOPIC_ID)!;
const BROAD =
  /\b(election|ballot|voter|voting|electoral|mail-?in|noncitizen|non-?citizen|voting machine|voter roll|registered to vote)\b/i;
const logger = new SupabaseLogger();
const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

// ── Phase A1: our topic note ids (canonical join) ────────────────────────────
const sightings = await logger.fetchAllRows<{ id: number; processed_run_id: string | null }>(
  (c) => c.from("misinfo_monitoring_sightings")
    .select("id, processed_run_id").eq("topic_id", TOPIC_ID).not("processed_run_id", "is", null),
  "id", "processed sightings");
const runs: { id: string; note_id: string | null }[] = [];
for (const ids of chunk(sightings.map((s) => s.processed_run_id!), 100)) {
  runs.push(...await logger.fetchAllRows<(typeof runs)[number]>(
    (c) => c.from("pipeline_runs").select("id, note_id").in("id", ids), "id"));
}
const ourNoteIds = new Set(runs.filter((r) => r.note_id).map((r) => r.note_id!));
// All of OUR notes ever (any pipeline) — excluded from the "ecosystem" set.
const allOurNotes = new Set((await logger.fetchAllRows<{ note_id: string }>(
  (c) => c.from("notes").select("note_id"), "note_id", "our notes")).map((n) => n.note_id));
console.log(`[targets] ${ourNoteIds.size} topic notes of ours; ${allOurNotes.size} our notes total`);

// ── Phase A2: ecosystem election notes from the local dump copy ──────────────
const eco = new Map<string, { tier: "strict" | "broad"; createdAtMillis: number; status?: string }>();
await forEachTsvRow(DUMP_DIR, "notes-", (cols, h) => {
  const i = (n: string) => h.indexOf(n);
  const noteId = cols[i("noteId")]!;
  if (allOurNotes.has(noteId)) return;
  const created = Number(cols[i("createdAtMillis")]);
  if (!Number.isFinite(created) || created < WINDOW_START) return;
  if (cols[i("classification")] !== "MISINFORMED_OR_POTENTIALLY_MISLEADING") return;
  const summary = cols[i("summary")] ?? "";
  const tier = topic.matches(summary.toLowerCase()) ? "strict" : BROAD.test(summary) ? "broad" : null;
  if (tier) eco.set(noteId, { tier, createdAtMillis: created });
});
await forEachTsvRow(DUMP_DIR, "noteStatusHistory-", (cols, h) => {
  const i = (n: string) => h.indexOf(n);
  const e = eco.get(cols[i("noteId")]!);
  if (e) e.status = cols[i("currentStatus")] ?? "";
});
const winners = [...eco.values()].filter((e) => e.status === "CURRENTLY_RATED_HELPFUL").length;
console.log(`[targets] ${eco.size} ecosystem election notes since 6/18 (${winners} currently Helpful)`);

const targetIds = new Set([...ourNoteIds, ...eco.keys()]);
writeFileSync(`${DIR}/targets.json`, JSON.stringify({
  generated_at: new Date().toISOString(),
  ours: [...ourNoteIds],
  eco: Object.fromEntries([...eco.entries()].map(([id, e]) => [id, { tier: e.tier, status: e.status ?? null }])),
}, null, 2));

// ── Phase B: stream every ratings partition ──────────────────────────────────
const dateForUrl = (d: Date) =>
  `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;

async function findDay(): Promise<{ dateStr: string; partitions: number }> {
  for (let back = 0; back < MAX_DAYS_BACK; back++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - back);
    const dateStr = dateForUrl(d);
    const head = await fetch(`${CN_DATA_BASE_URL}/${dateStr}/noteRatings/ratings-00000.zip`, { method: "HEAD" });
    if (!head.ok) continue;
    let n = 1;
    while ((await fetch(`${CN_DATA_BASE_URL}/${dateStr}/noteRatings/ratings-${String(n).padStart(5, "0")}.zip`, { method: "HEAD" })).ok) n++;
    return { dateStr, partitions: n };
  }
  throw new Error("no ratings partitions found within walk-back window");
}

const { dateStr, partitions } = await findDay();
console.log(`[ratings] ${partitions} partition(s) at ${dateStr}`);

const out = createWriteStream(`${DIR}/target_ratings.tsv`);
const raterTally = new Map<string, [number, number, number]>(); // h, s, n
let headerWritten = false;
let totalRows = 0;
let keptRows = 0;

for (let p = 0; p < partitions; p++) {
  const part = String(p).padStart(5, "0");
  const url = `${CN_DATA_BASE_URL}/${dateStr}/noteRatings/ratings-${part}.zip`;
  const proc = Bun.spawn(["sh", "-c", `curl -sf --retry 3 "${url}" | bsdtar -xOf -`], { stdout: "pipe", stderr: "pipe" });
  const rl = createInterface({ input: Readable.fromWeb(proc.stdout as any), crlfDelay: Infinity });

  let noteIdx = -1;
  let raterIdx = -1;
  let levelIdx = -1;
  let rows = 0;
  for await (const line of rl) {
    if (noteIdx === -1) {
      const h = line.split("\t");
      noteIdx = h.indexOf("noteId");
      raterIdx = h.indexOf("raterParticipantId");
      levelIdx = h.indexOf("helpfulnessLevel");
      if (noteIdx === -1 || raterIdx === -1 || levelIdx === -1)
        throw new Error(`partition ${part}: unexpected header ${h.slice(0, 12).join(",")}`);
      if (!headerWritten) {
        out.write(`HEADER\t${line}\n`);
        headerWritten = true;
      }
      continue;
    }
    rows++;
    const cols = line.split("\t");
    const level = cols[levelIdx];
    const t = raterTally.get(cols[raterIdx]!) ?? [0, 0, 0];
    if (level === "HELPFUL") t[0]++;
    else if (level === "SOMEWHAT_HELPFUL") t[1]++;
    else if (level === "NOT_HELPFUL") t[2]++;
    raterTally.set(cols[raterIdx]!, t);
    if (targetIds.has(cols[noteIdx]!)) {
      out.write(`${part}\t${line}\n`);
      keptRows++;
    }
  }
  const exit = await proc.exited;
  if (exit !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`partition ${part} stream failed (exit ${exit}): ${err.slice(0, 300)}`);
  }
  totalRows += rows;
  console.log(`[ratings] ${part}: ${rows.toLocaleString()} rows scanned, ${keptRows.toLocaleString()} kept so far, ${raterTally.size.toLocaleString()} raters tallied`);
}
await new Promise((res) => out.end(res));

// ── Filter global tallies to raters who rated OUR notes ─────────────────────
const ourRaters = new Set<string>();
{
  const text = await Bun.file(`${DIR}/target_ratings.tsv`).text();
  let noteIdx = -1;
  let raterIdx = -1;
  for (const line of text.split("\n")) {
    if (line.startsWith("HEADER\t")) {
      const h = line.split("\t").slice(1);
      noteIdx = h.indexOf("noteId") + 1; // +1 for the partition prefix column
      raterIdx = h.indexOf("raterParticipantId") + 1;
      continue;
    }
    if (!line) continue;
    const cols = line.split("\t");
    if (ourNoteIds.has(cols[noteIdx]!)) ourRaters.add(cols[raterIdx]!);
  }
}
writeFileSync(`${DIR}/rater_global_tallies.json`, JSON.stringify(
  Object.fromEntries([...ourRaters].map((r) => {
    const t = raterTally.get(r) ?? [0, 0, 0];
    return [r, { helpful: t[0], somewhat: t[1], not_helpful: t[2] }];
  })), null, 1));

console.log(`[done] ${totalRows.toLocaleString()} rows scanned; ${keptRows.toLocaleString()} kept ` +
  `(${targetIds.size.toLocaleString()} target notes); ${ourRaters.size} raters on our notes; ` +
  `tallies written for them (${raterTally.size.toLocaleString()} raters seen globally)`);
