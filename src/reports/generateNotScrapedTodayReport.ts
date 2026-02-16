import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // Get all note IDs scraped today
  const { data: todaySnaps } = await s.from("scraped_notewriter_snapshots")
    .select("note_id")
    .gte("scraped_at", today);

  const scrapedTodayIds = new Set((todaySnaps || []).map(s => s.note_id));
  console.log(`Notes scraped today: ${scrapedTodayIds.size}`);

  // Get all notes from scraped_notewriter_notes
  const { data: allNotes } = await s.from("scraped_notewriter_notes")
    .select("note_id, tweet_id, note_text");

  // Filter to notes NOT scraped today
  const notScrapedToday = (allNotes || []).filter(n => !scrapedTodayIds.has(n.note_id));
  console.log(`Notes NOT scraped today: ${notScrapedToday.length}`);

  // Get the most recent snapshot for each of these notes (for view count and status)
  const noteIds = notScrapedToday.map(n => n.note_id);
  const { data: snapshots } = await s.from("scraped_notewriter_snapshots")
    .select("note_id, cn_status, view_count, scraped_at")
    .in("note_id", noteIds)
    .order("scraped_at", { ascending: false });

  // Build a map of note_id -> latest snapshot with highest view count
  const noteSnapMap = new Map<string, { cn_status: string; view_count: number | null; scraped_at: string }>();
  for (const snap of snapshots || []) {
    const existing = noteSnapMap.get(snap.note_id);
    if (!existing) {
      noteSnapMap.set(snap.note_id, {
        cn_status: snap.cn_status,
        view_count: snap.view_count,
        scraped_at: snap.scraped_at
      });
    } else if ((snap.view_count || 0) > (existing.view_count || 0)) {
      noteSnapMap.set(snap.note_id, {
        cn_status: snap.cn_status,
        view_count: snap.view_count,
        scraped_at: snap.scraped_at
      });
    }
  }

  // Build final list
  const results: Array<{
    note_id: string;
    tweet_id: string;
    note_text: string;
    status: string;
    views: number | null;
    last_scraped: string;
  }> = [];

  for (const note of notScrapedToday) {
    const snap = noteSnapMap.get(note.note_id);
    results.push({
      note_id: note.note_id,
      tweet_id: note.tweet_id,
      note_text: note.note_text || "",
      status: snap?.cn_status || "UNKNOWN",
      views: snap?.view_count || null,
      last_scraped: snap?.scraped_at || "never"
    });
  }

  // Sort by views descending (nulls last)
  results.sort((a, b) => {
    if (a.views === null && b.views === null) return 0;
    if (a.views === null) return 1;
    if (b.views === null) return -1;
    return b.views - a.views;
  });

  const totalViews = results.reduce((sum, n) => sum + (n.views || 0), 0);
  const withViews = results.filter(n => n.views !== null);

  // Generate HTML with checkboxes
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notes NOT Scraped Today (${results.length} notes)</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 { color: #1a1a1a; margin-bottom: 10px; }
    .summary {
      background: #ff9800;
      color: white;
      padding: 20px;
      border-radius: 12px;
      margin-bottom: 20px;
      font-size: 18px;
    }
    .summary strong { font-size: 24px; }
    .export-btn {
      background: #2e7d32;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 16px;
      margin-top: 10px;
    }
    .export-btn:hover { background: #1b5e20; }
    .note-card {
      background: white;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .note-card.flagged-link { border-left: 4px solid #f44336; }
    .note-card.flagged-views { border-left: 4px solid #ff9800; }
    .note-card.flagged-both { border-left: 4px solid #9c27b0; }
    .note-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      flex-wrap: wrap;
      gap: 8px;
    }
    .views {
      background: #e8f5e9;
      color: #2e7d32;
      padding: 4px 12px;
      border-radius: 20px;
      font-weight: 600;
    }
    .no-views {
      background: #ffebee;
      color: #c62828;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
    }
    .status {
      background: #e3f2fd;
      color: #1565c0;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
    }
    .stale {
      background: #fff3e0;
      color: #e65100;
      padding: 4px 8px;
      border-radius: 8px;
      font-size: 11px;
    }
    .note-text {
      color: #333;
      line-height: 1.5;
      margin-bottom: 12px;
      white-space: pre-wrap;
      max-height: 100px;
      overflow: hidden;
    }
    .note-links {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .note-links a {
      color: #1da1f2;
      text-decoration: none;
      font-size: 14px;
    }
    .note-links a:hover { text-decoration: underline; }
    .rank {
      color: #999;
      font-size: 14px;
      margin-right: 8px;
    }
    .unavailable {
      color: #999;
      font-style: italic;
    }
    .checkboxes {
      display: flex;
      gap: 20px;
      padding-top: 10px;
      border-top: 1px solid #eee;
    }
    .checkboxes label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      font-size: 14px;
      color: #666;
    }
    .checkboxes input[type="checkbox"] {
      width: 18px;
      height: 18px;
      cursor: pointer;
    }
    .flagged-count {
      margin-top: 10px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <h1>Notes NOT Scraped Today</h1>
  <div class="summary">
    <strong>${results.length}</strong> notes not scraped today<br>
    <small>${withViews.length} have view counts (${totalViews.toLocaleString()} total views) | ${results.length - withViews.length} have no view data</small>
    <div class="flagged-count" id="flaggedCount">Flagged: 0 link issues, 0 view issues</div>
    <button class="export-btn" onclick="exportFlagged()">Export Flagged Notes</button>
  </div>

  ${results.map((n, i) => {
    const tweetUrl = n.tweet_id.startsWith("unavailable_") || n.tweet_id.startsWith("tweet_") || n.tweet_id === "unknown"
      ? null
      : `https://x.com/i/status/${n.tweet_id}`;
    const noteUrl = n.note_id.startsWith("tweet_")
      ? null
      : `https://x.com/i/birdwatch/n/${n.note_id}`;
    const escapedText = n.note_text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const lastScrapedDate = n.last_scraped === "never" ? "never" : new Date(n.last_scraped).toLocaleDateString();

    return `
  <div class="note-card" id="card-${i}" data-note-id="${n.note_id}" data-views="${n.views || 0}">
    <div class="note-header">
      <span>
        <span class="rank">#${i + 1}</span>
        ${n.views !== null
          ? `<span class="views">${n.views.toLocaleString()} views</span>`
          : '<span class="no-views">No view data</span>'}
      </span>
      <span>
        <span class="status">${n.status}</span>
        <span class="stale">Last: ${lastScrapedDate}</span>
      </span>
    </div>
    <div class="note-text">${escapedText || '<em>No note text available</em>'}</div>
    <div class="note-links">
      ${tweetUrl ? `<a href="${tweetUrl}" target="_blank">View Tweet</a>` : '<span class="unavailable">Tweet unavailable</span>'}
      ${noteUrl ? `<a href="${noteUrl}" target="_blank">View Note</a>` : ''}
    </div>
    <div class="checkboxes">
      <label>
        <input type="checkbox" class="flag-link" data-index="${i}" onchange="updateFlags()">
        Not our note / wrong link
      </label>
      <label>
        <input type="checkbox" class="flag-views" data-index="${i}" onchange="updateFlags()">
        View count wrong
      </label>
    </div>
  </div>`;
  }).join('\n')}

  <script>
    function updateFlags() {
      let linkCount = 0;
      let viewCount = 0;

      document.querySelectorAll('.flag-link:checked').forEach(() => linkCount++);
      document.querySelectorAll('.flag-views:checked').forEach(() => viewCount++);

      document.getElementById('flaggedCount').textContent =
        'Flagged: ' + linkCount + ' link issues, ' + viewCount + ' view issues';

      document.querySelectorAll('.note-card').forEach((card, i) => {
        const linkChecked = document.querySelector('.flag-link[data-index="' + i + '"]')?.checked;
        const viewChecked = document.querySelector('.flag-views[data-index="' + i + '"]')?.checked;

        card.classList.remove('flagged-link', 'flagged-views', 'flagged-both');
        if (linkChecked && viewChecked) card.classList.add('flagged-both');
        else if (linkChecked) card.classList.add('flagged-link');
        else if (viewChecked) card.classList.add('flagged-views');
      });
    }

    function exportFlagged() {
      const flagged = [];
      document.querySelectorAll('.note-card').forEach((card, i) => {
        const linkChecked = document.querySelector('.flag-link[data-index="' + i + '"]')?.checked;
        const viewChecked = document.querySelector('.flag-views[data-index="' + i + '"]')?.checked;

        if (linkChecked || viewChecked) {
          flagged.push({
            note_id: card.dataset.noteId,
            views: parseInt(card.dataset.views),
            wrong_link: linkChecked || false,
            wrong_views: viewChecked || false
          });
        }
      });

      const json = JSON.stringify(flagged, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'flagged-notes.json';
      a.click();
    }
  </script>
</body>
</html>`;

  const outputPath = "tmp/reports/not-scraped-today.html";
  writeFileSync(outputPath, html);
  console.log(`Written to ${outputPath}`);
  console.log(`${results.length} notes not scraped today (${withViews.length} have view counts)`);
}

main().catch(console.error);
