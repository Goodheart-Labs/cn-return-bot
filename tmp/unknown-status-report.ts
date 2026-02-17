import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const rows: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client.from(table).select(select).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

const notes = await fetchAll<{ note_id: string; tweet_id: string; note_text: string; created_at: string }>(
  "scraped_notewriter_notes", "note_id, tweet_id, note_text, created_at"
);
const snaps = await fetchAll<{ note_id: string; cn_status: string; view_count: number; scraped_at: string }>(
  "scraped_notewriter_snapshots", "note_id, cn_status, view_count, scraped_at"
);
const botNotes = await fetchAll<{ note_id: string; tweet_id: string; bot_name: string }>(
  "notes", "note_id, tweet_id, bot_name"
);

const noteMap = new Map(notes.map(n => [n.note_id, n]));
const botMap = new Map(botNotes.map(n => [n.note_id, n]));

// Group snapshots by note
const snapsByNote = new Map<string, typeof snaps>();
for (const s of snaps) {
  if (!snapsByNote.has(s.note_id)) snapsByNote.set(s.note_id, []);
  snapsByNote.get(s.note_id)!.push(s);
}

// Sort each note's snapshots newest first
for (const [_, noteSnaps] of snapsByNote) {
  noteSnaps.sort((a, b) => b.scraped_at.localeCompare(a.scraped_at));
}

// Find notes whose latest snapshot is UNKNOWN
const unknowns: {
  note_id: string;
  tweet_id: string;
  note_text: string;
  created_at: string;
  bot_name: string | null;
  snapshots: { status: string; views: number; date: string }[];
  bestKnownStatus: string | null;
}[] = [];

for (const [noteId, noteSnaps] of snapsByNote) {
  const latest = noteSnaps[0]!;
  const s = (latest.cn_status || "").toUpperCase().replace(/\s+/g, "_");
  if (s !== "UNKNOWN" && s !== "") continue;

  const note = noteMap.get(noteId);
  const bot = botMap.get(noteId);

  // Find best known (non-UNKNOWN) status
  const goodSnap = noteSnaps.find(sn => sn.cn_status && sn.cn_status !== "UNKNOWN");

  unknowns.push({
    note_id: noteId,
    tweet_id: note?.tweet_id || "?",
    note_text: note?.note_text || "",
    created_at: note?.created_at || "",
    bot_name: bot?.bot_name || null,
    snapshots: noteSnaps.map(sn => ({
      status: sn.cn_status || "(empty)",
      views: sn.view_count || 0,
      date: sn.scraped_at.slice(0, 10),
    })),
    bestKnownStatus: goodSnap?.cn_status || null,
  });
}

// Sort: ones with a previous good status first, then by note_id
unknowns.sort((a, b) => {
  if (a.bestKnownStatus && !b.bestKnownStatus) return -1;
  if (!a.bestKnownStatus && b.bestKnownStatus) return 1;
  return b.snapshots.length - a.snapshots.length;
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function statusBadge(status: string): string {
  const s = status.toUpperCase().replace(/\s+/g, "_");
  let cls = "unknown";
  if (s === "CURRENTLY_RATED_HELPFUL" || s === "SHOWN_ON_X") cls = "helpful";
  else if (s === "CURRENTLY_RATED_NOT_HELPFUL" || s === "NOT_SHOWN_ON_X") cls = "not-helpful";
  else if (s === "NEEDS_MORE_RATINGS") cls = "needs-more";
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

const withPrevious = unknowns.filter(u => u.bestKnownStatus);
const neverKnown = unknowns.filter(u => !u.bestKnownStatus);

const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>UNKNOWN Status Notes — ${unknowns.length} notes</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 1300px; margin: 0 auto; padding: 20px; background: #f8f9fa; }
  h1 { margin-bottom: 5px; }
  h2 { margin-top: 30px; border-bottom: 2px solid #dee2e6; padding-bottom: 8px; }
  .summary { color: #666; margin-bottom: 20px; }
  .note-card { background: white; border-radius: 8px; padding: 14px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .note-card.regressed { border-left: 4px solid #e67e22; }
  .note-card.always-unknown { border-left: 4px solid #95a5a6; }
  .note-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; font-size: 13px; }
  .note-header a { color: #1da1f2; text-decoration: none; }
  .note-header a:hover { text-decoration: underline; }
  code { font-size: 11px; background: #f0f0f0; padding: 2px 4px; border-radius: 3px; }
  .bot-tag { font-size: 11px; background: #e8daef; color: #6c3483; padding: 2px 6px; border-radius: 3px; }
  .note-text { color: #555; font-size: 12px; line-height: 1.4; margin-bottom: 8px; max-width: 800px; }
  .snapshot-timeline { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; font-size: 11px; }
  .snapshot-timeline .snap { padding: 3px 8px; border-radius: 4px; border: 1px solid #ddd; background: #fafafa; }
  .snapshot-timeline .snap.good { background: #d4edda; border-color: #27ae60; }
  .snapshot-timeline .snap.unknown { background: #f8d7da; border-color: #e74c3c; }
  .snapshot-timeline .arrow { color: #999; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .badge.helpful { background: #d4edda; color: #155724; }
  .badge.not-helpful { background: #f8d7da; color: #721c24; }
  .badge.needs-more { background: #fff3cd; color: #856404; }
  .badge.unknown { background: #e2e3e5; color: #383d41; }
  .best-status { font-size: 12px; margin-bottom: 6px; }
  .best-status b { color: #333; }
</style>
</head><body>
<h1>UNKNOWN Status Notes</h1>
<p class="summary">${unknowns.length} notes whose latest snapshot has UNKNOWN status. ${withPrevious.length} had a real status before (regressed). ${neverKnown.length} have never had a known status.</p>

<h2>Regressed — had a real status before (${withPrevious.length})</h2>
${withPrevious.map(u => `
<div class="note-card regressed">
  <div class="note-header">
    <a href="https://x.com/i/birdwatch/n/${u.note_id}" target="_blank"><code>${u.note_id}</code></a>
    <a href="https://x.com/i/web/status/${u.tweet_id}" target="_blank">tweet</a>
    ${u.bot_name ? `<span class="bot-tag">${escapeHtml(u.bot_name)}</span>` : ''}
    <span style="color:#888">created ${u.created_at.slice(0, 10)}</span>
  </div>
  <div class="best-status"><b>Best known status:</b> ${statusBadge(u.bestKnownStatus!)}</div>
  <div class="note-text">${u.note_text ? escapeHtml(u.note_text.slice(0, 250)) + (u.note_text.length > 250 ? '...' : '') : '<em>no text</em>'}</div>
  <div class="snapshot-timeline">
    ${u.snapshots.map((sn, i) => {
      const isUnknown = sn.status.toUpperCase() === "UNKNOWN";
      return `<span class="snap ${isUnknown ? 'unknown' : 'good'}">${sn.date}: ${sn.status}${sn.views ? ' (' + sn.views.toLocaleString() + ' views)' : ''}</span>${i < u.snapshots.length - 1 ? '<span class="arrow">←</span>' : ''}`;
    }).join('')}
  </div>
</div>
`).join('')}

<h2>Never known — always UNKNOWN (${neverKnown.length})</h2>
${neverKnown.map(u => `
<div class="note-card always-unknown">
  <div class="note-header">
    <a href="https://x.com/i/birdwatch/n/${u.note_id}" target="_blank"><code>${u.note_id}</code></a>
    <a href="https://x.com/i/web/status/${u.tweet_id}" target="_blank">tweet</a>
    ${u.bot_name ? `<span class="bot-tag">${escapeHtml(u.bot_name)}</span>` : ''}
    <span style="color:#888">created ${u.created_at.slice(0, 10)}</span>
    <span style="color:#888">${u.snapshots.length} snapshot${u.snapshots.length > 1 ? 's' : ''}</span>
  </div>
  <div class="note-text">${u.note_text ? escapeHtml(u.note_text.slice(0, 250)) + (u.note_text.length > 250 ? '...' : '') : '<em>no text</em>'}</div>
  <div class="snapshot-timeline">
    ${u.snapshots.map((sn, i) => {
      return `<span class="snap unknown">${sn.date}: ${sn.status}${sn.views ? ' (' + sn.views.toLocaleString() + ' views)' : ''}</span>${i < u.snapshots.length - 1 ? '<span class="arrow">←</span>' : ''}`;
    }).join('')}
  </div>
</div>
`).join('')}

</body></html>`;

writeFileSync("tmp/reports/unknown-status-notes.html", html);
console.log(`Generated: tmp/reports/unknown-status-notes.html (${unknowns.length} notes: ${withPrevious.length} regressed, ${neverKnown.length} never known)`);
