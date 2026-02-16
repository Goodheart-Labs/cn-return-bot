import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // Get all snapshots with view counts from today
  const { data: snaps } = await s.from("scraped_notewriter_snapshots")
    .select("note_id, cn_status, view_count, scraped_at")
    .gte("scraped_at", today)
    .not("view_count", "is", null)
    .order("view_count", { ascending: false });

  // Get note details
  const noteIds = [...new Set((snaps || []).map(s => s.note_id))];
  const { data: notes } = await s.from("scraped_notewriter_notes")
    .select("note_id, tweet_id, note_text")
    .in("note_id", noteIds);

  const noteMap = new Map<string, { tweet_id: string; note_text: string }>();
  for (const n of notes || []) {
    noteMap.set(n.note_id, { tweet_id: n.tweet_id, note_text: n.note_text || "" });
  }

  // Dedupe by note_id
  const noteData = new Map<string, { view_count: number; cn_status: string }>();
  for (const snap of snaps || []) {
    const existing = noteData.get(snap.note_id);
    if (!existing || (snap.view_count || 0) > existing.view_count) {
      noteData.set(snap.note_id, {
        view_count: snap.view_count || 0,
        cn_status: snap.cn_status
      });
    }
  }

  // Build results
  const results: Array<{
    note_id: string;
    tweet_id: string;
    note_text: string;
    status: string;
    views: number;
  }> = [];

  for (const [noteId, data] of noteData) {
    const info = noteMap.get(noteId);
    results.push({
      note_id: noteId,
      tweet_id: info?.tweet_id || "unknown",
      note_text: info?.note_text || "",
      status: data.cn_status,
      views: data.view_count
    });
  }

  results.sort((a, b) => b.views - a.views);
  const totalViews = results.reduce((sum, n) => sum + n.views, 0);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Review Notes - ${results.length} notes, ${totalViews.toLocaleString()} views</title>
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
      background: #1da1f2;
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
    .status {
      background: #e3f2fd;
      color: #1565c0;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
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
      color: #666;
    }
  </style>
</head>
<body>
  <h1>Review Notes - Today's Scrape</h1>
  <div class="summary">
    <strong>${results.length}</strong> notes with <strong>${totalViews.toLocaleString()}</strong> total views<br>
    <small>Scraped on ${new Date().toLocaleDateString()}</small><br>
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

    return `
  <div class="note-card" id="card-${i}" data-note-id="${n.note_id}" data-views="${n.views}">
    <div class="note-header">
      <span><span class="rank">#${i + 1}</span> <span class="views">${n.views.toLocaleString()} views</span></span>
      <span class="status">${n.status}</span>
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

      // Update card styling
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

  const outputPath = "tmp/reports/review-notes.html";
  writeFileSync(outputPath, html);
  console.log(`Written to ${outputPath}`);
  console.log(`${results.length} notes with ${totalViews.toLocaleString()} total views`);
}

main().catch(console.error);
