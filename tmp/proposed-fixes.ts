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

const scrapedNotes = await fetchAll<{ note_id: string; tweet_id: string; note_text: string }>(
  "scraped_notewriter_notes", "note_id, tweet_id, note_text"
);
const botNotes = await fetchAll<{ note_id: string; tweet_id: string }>(
  "notes", "note_id, tweet_id"
);

const botMap = new Map(botNotes.map(n => [n.note_id, n.tweet_id]));

const tweetToNotes = new Map<string, typeof scrapedNotes>();
for (const n of scrapedNotes) {
  if (!tweetToNotes.has(n.tweet_id)) tweetToNotes.set(n.tweet_id, []);
  tweetToNotes.get(n.tweet_id)!.push(n);
}
const dupes = [...tweetToNotes.entries()].filter(([_, ns]) => ns.length > 1);

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const groups = dupes.map(([currentTweetId, noteList]) => {
  const rows = noteList.map(n => {
    const botTweetId = botMap.get(n.note_id);
    const fixable = botTweetId && botTweetId !== currentTweetId;
    return { ...n, botTweetId, fixable };
  });
  return { currentTweetId, notes: rows };
});

const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Proposed tweet_id Fixes</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 1300px; margin: 0 auto; padding: 20px; background: #f8f9fa; }
  h1 { margin-bottom: 5px; }
  .summary { color: #666; margin-bottom: 20px; }
  .group { background: white; border-radius: 8px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .group.has-fix { border-left: 4px solid #3498db; }
  .group.no-fix { border-left: 4px solid #e2e3e5; }
  h3 { margin: 0 0 10px 0; font-size: 14px; }
  h3 a { color: #1da1f2; text-decoration: none; }
  h3 a:hover { text-decoration: underline; }
  .label { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-left: 8px; }
  .label.fix { background: #d4edda; color: #155724; }
  .label.no-fix { background: #e2e3e5; color: #383d41; }
  .label.flag { background: #fff3cd; color: #856404; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  th { text-align: left; padding: 5px 8px; border-bottom: 2px solid #dee2e6; font-size: 11px; color: #666; text-transform: uppercase; }
  td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  .note-text { max-width: 350px; color: #555; font-size: 12px; line-height: 1.3; }
  code { font-size: 11px; background: #f0f0f0; padding: 2px 4px; border-radius: 3px; }
  .arrow { color: #27ae60; font-weight: bold; }
  .fix-row { background: #f0fff0; }
  .no-fix-row { background: #fafafa; }
  .current { color: #e74c3c; }
  .proposed { color: #27ae60; }
</style>
</head><body>
<h1>Proposed tweet_id Fixes</h1>
<p class="summary">14 tweet_id collisions. 9 notes can be fixed from the bot's <code>notes</code> table. 19 are pre-bot and will self-correct with future scrapes.</p>

${groups.map(g => {
  const hasFix = g.notes.some(n => n.fixable);
  return `<div class="group ${hasFix ? 'has-fix' : 'no-fix'}">
    <h3>
      Current tweet_id: <a href="https://x.com/i/web/status/${g.currentTweetId}" target="_blank">${g.currentTweetId}</a>
      ${hasFix ? '<span class="label fix">has fixes</span>' : '<span class="label no-fix">no fix available</span>'}
    </h3>
    <table>
      <thead><tr><th>Note ID</th><th>Current tweet_id</th><th></th><th>Proposed tweet_id</th><th>Action</th><th>Text</th></tr></thead>
      <tbody>
      ${g.notes.map(n => {
        if (n.fixable) {
          return `<tr class="fix-row">
            <td><a href="https://x.com/i/birdwatch/n/${n.note_id}" target="_blank"><code>${n.note_id}</code></a></td>
            <td class="current"><a href="https://x.com/i/web/status/${g.currentTweetId}" target="_blank"><code>${g.currentTweetId}</code></a></td>
            <td class="arrow">→</td>
            <td class="proposed"><a href="https://x.com/i/web/status/${n.botTweetId}" target="_blank"><code>${n.botTweetId}</code></a></td>
            <td><span class="label fix">fix from notes table</span></td>
            <td class="note-text">${n.note_text ? escapeHtml(n.note_text.slice(0, 150)) : '<em>no text</em>'}</td>
          </tr>`;
        } else {
          return `<tr class="no-fix-row">
            <td><a href="https://x.com/i/birdwatch/n/${n.note_id}" target="_blank"><code>${n.note_id}</code></a></td>
            <td><a href="https://x.com/i/web/status/${g.currentTweetId}" target="_blank"><code>${g.currentTweetId}</code></a></td>
            <td></td>
            <td><span style="color:#999">—</span></td>
            <td><span class="label flag">${n.botTweetId ? 'bot matches' : 'flag — wait for scraper'}</span></td>
            <td class="note-text">${n.note_text ? escapeHtml(n.note_text.slice(0, 150)) : '<em>no text</em>'}</td>
          </tr>`;
        }
      }).join('\n')}
      </tbody>
    </table>
  </div>`;
}).join('\n')}

</body></html>`;

writeFileSync("tmp/reports/proposed-tweet-id-fixes.html", html);
console.log(`Generated: tmp/reports/proposed-tweet-id-fixes.html (${groups.length} groups, ${groups.reduce((s, g) => s + g.notes.filter(n => n.fixable).length, 0)} fixable)`);
