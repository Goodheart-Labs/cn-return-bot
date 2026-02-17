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

const notes = await fetchAll<{ note_id: string; tweet_id: string; created_at: string; note_text: string }>(
  "scraped_notewriter_notes", "note_id, tweet_id, created_at, note_text"
);
const snaps = await fetchAll<{ note_id: string; cn_status: string; view_count: number; scraped_at: string }>(
  "scraped_notewriter_snapshots", "note_id, cn_status, view_count, scraped_at"
);

const sortedSnaps = [...snaps].sort((a, b) => b.scraped_at.localeCompare(a.scraped_at));
const latestSnap = new Map<string, { status: string; views: number }>();
for (const s of sortedSnaps) {
  if (!latestSnap.has(s.note_id)) {
    latestSnap.set(s.note_id, { status: s.cn_status, views: s.view_count || 0 });
  }
}

const tweetToNotes = new Map<string, typeof notes>();
for (const n of notes) {
  if (!tweetToNotes.has(n.tweet_id)) tweetToNotes.set(n.tweet_id, []);
  tweetToNotes.get(n.tweet_id)!.push(n);
}
const multiNotes = [...tweetToNotes.entries()]
  .filter(([_, ns]) => ns.length > 1)
  .sort((a, b) => b[1].length - a[1].length);

function statusClass(status: string): string {
  const s = status.toUpperCase().replace(/\s+/g, "_");
  if (s === "CURRENTLY_RATED_HELPFUL" || s === "SHOWN_ON_X") return "helpful";
  if (s === "CURRENTLY_RATED_NOT_HELPFUL" || s === "NOT_SHOWN_ON_X") return "not-helpful";
  if (s === "NEEDS_MORE_RATINGS") return "needs-more";
  return "unknown";
}

function statusLabel(status: string): string {
  const s = status.toUpperCase().replace(/\s+/g, "_");
  if (s === "CURRENTLY_RATED_HELPFUL") return "Helpful";
  if (s === "SHOWN_ON_X") return "Shown on X";
  if (s === "CURRENTLY_RATED_NOT_HELPFUL") return "Not Helpful";
  if (s === "NOT_SHOWN_ON_X") return "Not Shown";
  if (s === "NEEDS_MORE_RATINGS") return "Needs More Ratings";
  return status || "Unknown";
}

const groupsData = multiNotes.map(([tweetId, noteList]) => {
  const sorted = noteList.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    tweetId,
    notes: sorted.map(n => {
      const snap = latestSnap.get(n.note_id);
      return {
        noteId: n.note_id,
        created: n.created_at?.slice(0, 10) || "?",
        status: snap?.status || "UNKNOWN",
        statusClass: snap ? statusClass(snap.status) : "unknown",
        statusLabel: snap ? statusLabel(snap.status) : "Unknown",
        views: snap?.views || 0,
        text: n.note_text?.slice(0, 300) || "",
      };
    }),
  };
});

const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Duplicate Tweet Audit — ${multiNotes.length} tweets</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f8f9fa; }
  h1 { margin-bottom: 5px; }
  .summary { color: #666; margin-bottom: 10px; }
  .actions-bar { position: sticky; top: 0; background: #fff; padding: 12px 16px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); margin-bottom: 16px; z-index: 100; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .actions-bar .stats { font-size: 13px; color: #666; }
  .actions-bar .stats b { color: #333; }
  .actions-bar button { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; }
  .btn-copy { background: #3498db; color: white; }
  .btn-copy:hover { background: #2980b9; }
  .btn-generate { background: #e74c3c; color: white; }
  .btn-generate:hover { background: #c0392b; }

  .tweet-group { background: white; border-radius: 8px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  h3 { margin: 0 0 10px 0; font-size: 14px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  h3 a { color: #1da1f2; text-decoration: none; }
  h3 a:hover { text-decoration: underline; }
  .count { color: #888; font-weight: normal; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 5px 8px; border-bottom: 2px solid #dee2e6; font-size: 11px; color: #666; text-transform: uppercase; }
  td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  .note-text { max-width: 400px; color: #555; font-size: 12px; line-height: 1.3; }
  code { font-size: 11px; background: #f0f0f0; padding: 2px 4px; border-radius: 3px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .badge.helpful { background: #d4edda; color: #155724; }
  .badge.not-helpful { background: #f8d7da; color: #721c24; }
  .badge.needs-more { background: #fff3cd; color: #856404; }
  .badge.unknown { background: #e2e3e5; color: #383d41; }
  tr.helpful { background: #f0fff0; }
  tr.not-helpful { background: #fff5f5; }
  tr.is-deleted { opacity: 0.4; }

  .btn-toggle { padding: 3px 10px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600; min-width: 60px; }
  .btn-toggle.keep { background: #d4edda; color: #155724; border-color: #27ae60; }
  .btn-toggle.delete { background: #f8d7da; color: #721c24; border-color: #e74c3c; }

  #deletion-output { display: none; margin-top: 16px; background: white; border-radius: 8px; padding: 16px; }
  #deletion-output pre { background: #f0f0f0; padding: 12px; border-radius: 4px; font-size: 12px; max-height: 300px; overflow: auto; }
</style>
</head><body>
<h1>Duplicate Tweet Audit</h1>
<p class="summary">${multiNotes.length} tweets with 2+ notes. The most recent note per tweet is kept by default. Click keep/delete on individual rows to override.</p>

<div class="actions-bar">
  <div class="stats">
    Keep: <b id="keep-count">0</b> |
    Delete: <b id="delete-count">0</b>
  </div>
  <button class="btn-copy" onclick="copyDeletionList()">Copy deletion note_ids</button>
  <button class="btn-generate" onclick="showDeletionScript()">Generate deletion script</button>
</div>

<div id="groups"></div>

<div id="deletion-output">
  <h3>Deletion script</h3>
  <p>Save to tmp/delete-dupes.ts and run with bun:</p>
  <pre id="deletion-script"></pre>
  <button class="btn-copy" onclick="navigator.clipboard.writeText(document.getElementById('deletion-script').textContent)">Copy script</button>
</div>

<script>
const groups = ${JSON.stringify(groupsData)};

// Track kept note_ids. Default: most recent per group is kept, rest deleted.
const keptNotes = new Set();
for (const g of groups) {
  keptNotes.add(g.notes[g.notes.length - 1].noteId);
}

function render() {
  const container = document.getElementById('groups');
  container.innerHTML = groups.map(g => {
    return '<div class="tweet-group">' +
      '<h3>' +
        '<a href="https://x.com/i/web/status/'+g.tweetId+'" target="_blank">'+g.tweetId+'</a>' +
        '<span class="count">'+g.notes.length+' notes</span>' +
      '</h3>' +
      '<table><thead><tr><th style="width:70px"></th><th>Note ID</th><th>Created</th><th>Status</th><th>Views</th><th>Text</th></tr></thead><tbody>' +
      g.notes.map(n => {
        const isKept = keptNotes.has(n.noteId);
        return '<tr class="'+n.statusClass + (isKept ? '' : ' is-deleted')+'">' +
          '<td><button class="btn-toggle '+(isKept ? 'keep' : 'delete')+'" onclick="toggle(\\''+n.noteId+'\\')">'+
            (isKept ? 'keep' : 'delete') +
          '</button></td>' +
          '<td><a href="https://x.com/i/birdwatch/n/'+n.noteId+'" target="_blank"><code>'+n.noteId+'</code></a></td>' +
          '<td>'+n.created+'</td>' +
          '<td><span class="badge '+n.statusClass+'">'+n.statusLabel+'</span></td>' +
          '<td>'+n.views.toLocaleString()+'</td>' +
          '<td class="note-text">'+(n.text ? escapeHtml(n.text) : '<em>no text</em>')+'</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }).join('');

  updateStats();
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function toggle(noteId) {
  if (keptNotes.has(noteId)) keptNotes.delete(noteId);
  else keptNotes.add(noteId);
  render();
}

function getAllNoteIds() {
  const all = [];
  for (const g of groups) for (const n of g.notes) all.push(n.noteId);
  return all;
}

function getDeletionIds() {
  return getAllNoteIds().filter(id => !keptNotes.has(id));
}

function updateStats() {
  const all = getAllNoteIds();
  const deleteIds = getDeletionIds();
  document.getElementById('keep-count').textContent = all.length - deleteIds.length;
  document.getElementById('delete-count').textContent = deleteIds.length;
}

function copyDeletionList() {
  const ids = getDeletionIds();
  navigator.clipboard.writeText(JSON.stringify(ids, null, 2));
  alert('Copied ' + ids.length + ' note IDs to clipboard');
}

function showDeletionScript() {
  const ids = getDeletionIds();
  if (ids.length === 0) { alert('Nothing to delete'); return; }
  const script = 'import "dotenv/config";\\n' +
    'import { createClient } from "@supabase/supabase-js";\\n' +
    'const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);\\n\\n' +
    'const toDelete = ' + JSON.stringify(ids) + ';\\n\\n' +
    'console.log("Deleting " + toDelete.length + " notes and their snapshots...");\\n\\n' +
    'for (let i = 0; i < toDelete.length; i += 50) {\\n' +
    '  const batch = toDelete.slice(i, i + 50);\\n' +
    '  const { error: snapErr } = await client.from("scraped_notewriter_snapshots").delete().in("note_id", batch);\\n' +
    '  if (snapErr) { console.error("Snapshot delete error:", snapErr); process.exit(1); }\\n' +
    '  const { error: noteErr } = await client.from("scraped_notewriter_notes").delete().in("note_id", batch);\\n' +
    '  if (noteErr) { console.error("Note delete error:", noteErr); process.exit(1); }\\n' +
    '  console.log("Deleted batch", Math.floor(i/50)+1, "(" + batch.length + " notes)");\\n' +
    '}\\n\\n' +
    'console.log("Done. Deleted " + toDelete.length + " duplicate notes.");\\n';
  document.getElementById('deletion-script').textContent = script;
  document.getElementById('deletion-output').style.display = 'block';
  document.getElementById('deletion-output').scrollIntoView({ behavior: 'smooth' });
}

render();
</script>
</body></html>`;

writeFileSync("tmp/reports/duplicate-tweets-audit.html", html);
console.log(`Generated: tmp/reports/duplicate-tweets-audit.html (${multiNotes.length} tweet groups, ${groupsData.reduce((s, g) => s + g.notes.length, 0)} notes)`);
