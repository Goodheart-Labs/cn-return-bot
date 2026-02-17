import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

async function main() {
  // Get all snapshots with helpful status
  const { data: snaps } = await s.from("scraped_notewriter_snapshots")
    .select("note_id, cn_status, view_count, scraped_at")
    .in("cn_status", ["CURRENTLY_RATED_HELPFUL", "SHOWN_ON_X", "Currently rated helpful"])
    .order("scraped_at", { ascending: false });

  // Get latest per note with highest view count
  const noteData = new Map<string, { cn_status: string; view_count: number }>();
  for (const snap of snaps || []) {
    const existing = noteData.get(snap.note_id);
    if (!existing) {
      noteData.set(snap.note_id, {
        cn_status: snap.cn_status,
        view_count: snap.view_count || 0
      });
    } else if ((snap.view_count || 0) > existing.view_count) {
      noteData.set(snap.note_id, {
        cn_status: snap.cn_status,
        view_count: snap.view_count || 0
      });
    }
  }

  // Get tweet_ids and note_text from scraped_notewriter_notes
  const noteIds = [...noteData.keys()];
  const { data: scrapedNotes } = await s.from("scraped_notewriter_notes")
    .select("note_id, tweet_id, note_text")
    .in("note_id", noteIds);

  const noteInfoMap = new Map<string, { tweet_id: string; note_text: string }>();
  for (const n of scrapedNotes || []) {
    noteInfoMap.set(n.note_id, { tweet_id: n.tweet_id, note_text: n.note_text || "" });
  }

  // Build final list
  const helpful: Array<{
    note_id: string;
    tweet_id: string;
    note_text: string;
    status: string;
    views: number;
  }> = [];

  for (const [noteId, data] of noteData) {
    const info = noteInfoMap.get(noteId);
    if (info) {
      helpful.push({
        note_id: noteId,
        tweet_id: info.tweet_id,
        note_text: info.note_text,
        status: data.cn_status,
        views: data.view_count
      });
    }
  }

  // Sort by views descending
  helpful.sort((a, b) => b.views - a.views);

  // Calculate total
  const totalViews = helpful.reduce((sum, n) => sum + n.views, 0);

  // Generate HTML
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Helpful Community Notes - ${helpful.length} notes, ${totalViews.toLocaleString()} views</title>
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
    .note-card {
      background: white;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
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
    }
    .note-links {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
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
  </style>
</head>
<body>
  <h1>Helpful Community Notes</h1>
  <div class="summary">
    <strong>${helpful.length}</strong> helpful notes with <strong>${totalViews.toLocaleString()}</strong> total views
  </div>

  ${helpful.map((n, i) => {
    const tweetUrl = n.tweet_id.startsWith("unavailable_")
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
  <div class="note-card">
    <div class="note-header">
      <span><span class="rank">#${i + 1}</span> <span class="views">${n.views.toLocaleString()} views</span></span>
      <span class="status">${n.status}</span>
    </div>
    <div class="note-text">${escapedText || '<em>No note text available</em>'}</div>
    <div class="note-links">
      ${tweetUrl ? `<a href="${tweetUrl}" target="_blank">View Tweet</a>` : '<span class="unavailable">Tweet unavailable</span>'}
      ${noteUrl ? `<a href="${noteUrl}" target="_blank">View Note</a>` : ''}
    </div>
  </div>`;
  }).join('\n')}
</body>
</html>`;

  const outputPath = "/tmp/helpful-notes-report.html";
  writeFileSync(outputPath, html);
  console.log(`Written to ${outputPath}`);
  console.log(`${helpful.length} helpful notes with ${totalViews.toLocaleString()} total views`);
}

main().catch(console.error);
