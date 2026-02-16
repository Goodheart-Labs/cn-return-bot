/**
 * Generate HTML report of notes rated "not helpful" for analysis
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

interface NoteWithStatus {
  note_id: string;
  tweet_id: string;
  bot_name: string;
  note_text: string;
  source_url: string | null;
  submitted_at: string;
  cn_status: string;
  view_count: number | null;
}

async function getNotHelpfulNotes(botName?: string): Promise<NoteWithStatus[]> {
  // Get all notes
  let notesQuery = supabase
    .from("notes")
    .select("note_id, tweet_id, bot_name, note_text, source_url, submitted_at");

  if (botName) {
    notesQuery = notesQuery.eq("bot_name", botName);
  }

  const { data: notes, error: notesError } = await notesQuery;
  if (notesError) throw notesError;

  // Get latest snapshots for these notes
  const noteIds = (notes || []).map((n) => n.note_id);
  const { data: snapshots, error: snapshotsError } = await supabase
    .from("scraped_notewriter_snapshots")
    .select("note_id, cn_status, view_count, scraped_at")
    .in("note_id", noteIds)
    .order("scraped_at", { ascending: false });

  if (snapshotsError) throw snapshotsError;

  // Get latest snapshot per note
  const latestByNote = new Map<
    string,
    { cn_status: string; view_count: number | null }
  >();
  for (const snap of snapshots || []) {
    if (!latestByNote.has(snap.note_id)) {
      latestByNote.set(snap.note_id, {
        cn_status: snap.cn_status,
        view_count: snap.view_count,
      });
    }
  }

  // Filter to not helpful
  const notHelpful: NoteWithStatus[] = [];
  for (const note of notes || []) {
    const latest = latestByNote.get(note.note_id);
    if (
      latest &&
      (latest.cn_status === "CURRENTLY_RATED_NOT_HELPFUL" ||
        latest.cn_status === "NOT_SHOWN_ON_X")
    ) {
      notHelpful.push({
        ...note,
        cn_status: latest.cn_status,
        view_count: latest.view_count,
      });
    }
  }

  // Sort by submitted_at descending
  notHelpful.sort(
    (a, b) =>
      new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
  );

  return notHelpful;
}

function generateHtml(notes: NoteWithStatus[], botFilter?: string): string {
  const title = botFilter
    ? `Not Helpful Notes - ${botFilter}`
    : "Not Helpful Notes - All Bots";

  const rows = notes
    .map(
      (n) => `
    <tr>
      <td>
        <a href="https://x.com/i/status/${n.tweet_id}" target="_blank">${n.tweet_id}</a>
      </td>
      <td class="bot-name">${n.bot_name}</td>
      <td class="note-text">${escapeHtml(n.note_text)}</td>
      <td class="status ${n.cn_status.toLowerCase().replace(/_/g, "-")}">${formatStatus(n.cn_status)}</td>
      <td>${n.view_count ?? "—"}</td>
      <td>${new Date(n.submitted_at).toLocaleDateString()}</td>
    </tr>
  `
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    :root {
      --bg: #0f0f0f;
      --card-bg: #1a1a1a;
      --text: #e0e0e0;
      --text-muted: #888;
      --border: #333;
      --red: #ef4444;
      --orange: #f97316;
    }

    * { box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 20px;
      line-height: 1.5;
    }

    h1 {
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }

    .subtitle {
      color: var(--text-muted);
      margin-bottom: 2rem;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--card-bg);
      border-radius: 8px;
      overflow: hidden;
    }

    th, td {
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }

    th {
      background: #222;
      font-weight: 600;
      color: var(--text-muted);
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    tr:hover {
      background: #222;
    }

    a {
      color: #60a5fa;
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    .bot-name {
      font-family: monospace;
      font-size: 0.85rem;
    }

    .note-text {
      max-width: 400px;
      font-size: 0.9rem;
    }

    .status {
      font-size: 0.8rem;
      padding: 4px 8px;
      border-radius: 4px;
      display: inline-block;
    }

    .status.currently-rated-not-helpful {
      background: rgba(239, 68, 68, 0.2);
      color: var(--red);
    }

    .status.not-shown-on-x {
      background: rgba(249, 115, 22, 0.2);
      color: var(--orange);
    }

    .summary {
      display: flex;
      gap: 2rem;
      margin-bottom: 2rem;
    }

    .stat {
      background: var(--card-bg);
      padding: 1rem 1.5rem;
      border-radius: 8px;
    }

    .stat-value {
      font-size: 2rem;
      font-weight: bold;
    }

    .stat-label {
      color: var(--text-muted);
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p class="subtitle">Notes that were rated "not helpful" by the community</p>

  <div class="summary">
    <div class="stat">
      <div class="stat-value">${notes.length}</div>
      <div class="stat-label">Not Helpful Notes</div>
    </div>
    <div class="stat">
      <div class="stat-value">${notes.filter((n) => n.cn_status === "CURRENTLY_RATED_NOT_HELPFUL").length}</div>
      <div class="stat-label">Currently Rated Not Helpful</div>
    </div>
    <div class="stat">
      <div class="stat-value">${notes.filter((n) => n.cn_status === "NOT_SHOWN_ON_X").length}</div>
      <div class="stat-label">Not Shown on X</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Tweet</th>
        <th>Bot</th>
        <th>Note Text</th>
        <th>Status</th>
        <th>Views</th>
        <th>Date</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <p class="subtitle" style="margin-top: 2rem;">
    Generated ${new Date().toISOString()}
  </p>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function main() {
  const botFilter = process.argv[2]; // Optional bot name filter

  console.log(
    botFilter
      ? `Fetching not-helpful notes for ${botFilter}...`
      : "Fetching all not-helpful notes..."
  );

  const notes = await getNotHelpfulNotes(botFilter);
  console.log(`Found ${notes.length} not-helpful notes`);

  const html = generateHtml(notes, botFilter);

  const filename = botFilter
    ? `not-helpful-${botFilter}.html`
    : "not-helpful-all.html";
  const outputPath = path.join(process.cwd(), "tmp", "reports", filename);
  fs.writeFileSync(outputPath, html);
  console.log(`Report generated: ${outputPath}`);
}

main().catch(console.error);
