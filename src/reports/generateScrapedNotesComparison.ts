import { SupabaseLogger } from "../api/supabaseClient";

async function generateScrapedNotesComparison() {
  const supabase = new SupabaseLogger();

  // Fetch the 30 most recent scraped notes (by note_id descending)
  // Exclude placeholder note IDs (tweet_XXXXX format)
  const { data: scrapedNotes, error } = await supabase["client"]
    .from("scraped_notewriter_notes")
    .select("note_id, tweet_id, note_text, source_url")
    .not("note_id", "like", "tweet_%")
    .order("note_id", { ascending: false })
    .limit(30);

  if (error) {
    console.error("Error fetching scraped notes:", error);
    process.exit(1);
  }

  // Get the latest snapshot for each note (for status)
  const noteIds = scrapedNotes.map((n) => n.note_id);
  const { data: snapshots } = await supabase["client"]
    .from("scraped_notewriter_snapshots")
    .select("note_id, cn_status, scraped_at")
    .in("note_id", noteIds)
    .order("scraped_at", { ascending: false });

  // Build a map of note_id -> latest status
  const statusMap: Record<string, string> = {};
  for (const snap of snapshots || []) {
    if (!statusMap[snap.note_id]) {
      statusMap[snap.note_id] = snap.cn_status || "Unknown";
    }
  }

  // Get bot information from the notes table
  const { data: botInfo } = await supabase["client"]
    .from("notes")
    .select("note_id, bot_name")
    .in("note_id", noteIds);

  // Build a map of note_id -> bot_name
  const botMap: Record<string, string> = {};
  for (const note of botInfo || []) {
    if (note.bot_name) {
      botMap[note.note_id] = note.bot_name;
    }
  }

  // Generate HTML
  const html = generateHTML(scrapedNotes, statusMap, botMap);

  // Write to file
  const fs = await import("fs");
  const path = await import("path");
  const outputPath = path.join(process.cwd(), "tmp", "reports", "scraped-notes-comparison.html");
  fs.writeFileSync(outputPath, html, "utf-8");

  console.log(`✓ Generated comparison page: ${outputPath}`);
  console.log(`  Found ${scrapedNotes.length} notes`);
  console.log(`  ${Object.keys(botMap).length} notes matched with bot info`);
}

function generateHTML(
  notes: Array<{
    note_id: string;
    tweet_id: string;
    note_text: string | null;
    source_url: string | null;
  }>,
  statusMap: Record<string, string>,
  botMap: Record<string, string>
): string {
  const noteCards = notes
    .map((note, index) => {
      const status = statusMap[note.note_id] || "Unknown";
      const botName = botMap[note.note_id] || "Unknown";
      const isUnavailable = note.tweet_id.startsWith("unavailable_");

      // Status badge colors
      const statusColors: Record<string, { bg: string; border: string; color: string }> = {
        CURRENTLY_SHOWN: { bg: "rgba(34, 197, 94, 0.2)", border: "#22c55e", color: "#22c55e" },
        NEEDS_MORE_RATINGS: { bg: "rgba(245, 158, 11, 0.2)", border: "#f59e0b", color: "#f59e0b" },
        CURRENTLY_RATED_HELPFUL: { bg: "rgba(34, 197, 94, 0.2)", border: "#22c55e", color: "#22c55e" },
        CURRENTLY_RATED_NOT_HELPFUL: { bg: "rgba(239, 68, 68, 0.2)", border: "#ef4444", color: "#ef4444" },
        Unknown: { bg: "rgba(156, 163, 175, 0.2)", border: "#9ca3af", color: "#9ca3af" },
      };

      const statusLabel: Record<string, string> = {
        CURRENTLY_SHOWN: "Shown on X",
        NEEDS_MORE_RATINGS: "Needs More Ratings",
        CURRENTLY_RATED_HELPFUL: "Helpful",
        CURRENTLY_RATED_NOT_HELPFUL: "Not Helpful",
        Unknown: "Unknown",
      };

      const colors = (statusColors[status] || statusColors.Unknown)!;
      const label = statusLabel[status] || status;

      const tweetUrl = isUnavailable ? "#" : `https://x.com/i/status/${note.tweet_id}`;
      const tweetDisplay = isUnavailable ? `unavailable_${note.note_id}` : note.tweet_id;
      const icon = isUnavailable ? "⚠️" : "📌";
      const noteClass = isUnavailable ? "note unavailable" : "note";

      return `
    <div class="${noteClass}">
      <div class="note-header">
        <div class="note-icon">${icon}</div>
        <div class="note-meta">
          <div class="note-number">#${index + 1}</div>
          <div class="note-id">Note ID: ${note.note_id}</div>
          <div class="note-username">@wholesome-raspberry-stilt</div>
          <div class="bot-name">Bot: ${botName}</div>
          <span class="note-status-badge" style="background: ${colors.bg}; border-color: ${colors.border}; color: ${colors.color};">${label}</span>
          <div><a href="${tweetUrl}" class="tweet-link" target="_blank">Tweet: ${tweetDisplay} →</a></div>
        </div>
      </div>
      <div class="note-text">${note.note_text || "No text available"}</div>
      ${note.source_url ? `<a href="${note.source_url}" class="source-link" target="_blank">🔗 Source</a>` : ""}
    </div>
  `;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Top 30 Most Recent Notes</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #15202b;
      color: #ffffff;
      padding: 20px;
      line-height: 1.5;
    }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 10px; color: #1da1f2; }
    .subtitle { color: #8899a6; margin-bottom: 30px; font-size: 14px; }
    .note {
      background: #192734;
      border: 1px solid #38444d;
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 20px;
      transition: border-color 0.2s;
    }
    .note:hover { border-color: #1da1f2; }
    .note-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid #38444d;
    }
    .note-icon {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, #1da1f2, #14171a);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }
    .note-meta { flex: 1; }
    .note-number { font-size: 12px; font-weight: 700; color: #8899a6; margin-bottom: 4px; }
    .note-id { font-size: 13px; color: #8899a6; font-family: "Courier New", monospace; }
    .note-username { font-size: 12px; color: #1da1f2; margin-top: 2px; }
    .bot-name {
      font-size: 12px;
      color: #f59e0b;
      margin-top: 2px;
      font-weight: 600;
    }
    .note-status-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      margin-top: 4px;
      border: 1px solid;
    }
    .tweet-link {
      color: #1da1f2;
      text-decoration: none;
      font-size: 12px;
      display: inline-block;
      margin-top: 2px;
    }
    .tweet-link:hover { text-decoration: underline; }
    .note-text { color: #ffffff; margin-bottom: 12px; font-size: 15px; word-wrap: break-word; }
    .source-link {
      display: inline-block;
      color: #1da1f2;
      text-decoration: none;
      font-size: 14px;
      padding: 6px 12px;
      background: rgba(29, 161, 242, 0.1);
      border: 1px solid #1da1f2;
      border-radius: 20px;
      transition: all 0.2s;
    }
    .source-link:hover { background: rgba(29, 161, 242, 0.2); }
    .unavailable { background: rgba(239, 68, 68, 0.05); border-color: rgba(239, 68, 68, 0.3); }
    .unavailable .tweet-link { color: #ef4444; pointer-events: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📝 Top 30 Most Recent Notes</h1>
    <p class="subtitle">Sorted by note ID descending (most recent first) · All from @wholesome-raspberry-stilt</p>

${noteCards}

  </div>
</body>
</html>`;
}

generateScrapedNotesComparison().catch(console.error);
