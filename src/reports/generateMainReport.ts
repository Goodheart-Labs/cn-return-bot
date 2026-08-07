/**
 * This script generates the main report. The documentation for it is in
 * docs/main-report.md.
 */
import "dotenv/config";

const useLocal = process.argv.includes("--local");
if (useLocal) {
  const localUrl = process.env.LOCAL_SUPABASE_URL;
  const localKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
  if (!localUrl || !localKey) {
    console.error("[report] --local requires LOCAL_SUPABASE_URL and LOCAL_SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  process.env.SUPABASE_URL = localUrl;
  process.env.SUPABASE_SERVICE_KEY = localKey;
  console.log(`[report] Using local Supabase at ${localUrl}`);
}

import { getSupabaseClient } from "../api/supabaseClient";
import { fetchAllRows, fetchInBatches } from "../api/paging";
import { resolvePicks } from "../pipeline/ab-testing/abTests";
import { snowflakeToDate } from "../pipeline/utils/snowflake";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";

const client = getSupabaseClient();

console.log("Fetching data...");

// 1. Every note. This is the report's primary data source. The notes table was merged
// with the old canonical table, so submission metadata, ratings and status now all sit
// on one row.
const scrapedNotes = await fetchAllRows<{
  note_id: string;
  tweet_id: string;
  cn_status: string | null;
  view_count: number | null;
  data_tier: string | null;
  first_seen_at: string;
  submitted_at: string | null;
  rating_count: number | null;
  helpful_count: number | null;
  not_helpful_count: number | null;
}>(
  // A NULL data_tier means the note reached us through the public-data ingest and the
  // scraper never reconciled it. Those are real submitted notes, so the filter has to
  // keep them. Before the tables were merged this filter only had to exclude the junk
  // tier, because the scraper set data_tier on every canonical row. The merged notes
  // table also holds rows that only ever came from public data, and those rows are
  // allowed to have NULL there.
  () => client.from("notes")
    .select("note_id, tweet_id, cn_status, view_count, data_tier, first_seen_at, submitted_at, rating_count, helpful_count, not_helpful_count")
    .or("data_tier.neq.junk,data_tier.is.null"),
  "note_id",
  { label: "report.scrapedNotes" },
);
console.log(`  ${scrapedNotes.length} notes (non-junk)`);

// 2. The bot name for each note. It comes from the pipeline_runs row that produced the
// note. The notes table no longer carries a copy of bot_name.
const botRuns = await fetchAllRows<{
  id: string;
  note_id: string;
  bot_name: string | null;
}>(
  () => client.from("pipeline_runs").select("id, note_id, bot_name").eq("outcome", "submitted").not("note_id", "is", null),
  "id",
  { label: "report.botRuns" },
);
console.log(`  ${botRuns.length} submitted runs (for bot_name mapping)`);

// 3. Every pipeline run, fetched in one query with all the fields the report needs.
// The report groups runs under a made-up variant label of the form
// "<bot>_<variant1>-<variant2>-...", built from ab_test_picks. Migration 039 removed
// the stored long bot name, so this label is what makes the per-variant breakdowns
// possible.
const rawPipelineRunsFull = await fetchAllRows<{
  id: string;
  bot_name: string | null;
  ab_test_picks: Record<string, string> | null;
  outcome: string;
  outcome_reason: string | null;
  created_at: string;
  tweet_id: string;
}>(
  () => client.from("pipeline_runs").select("id, bot_name, ab_test_picks, outcome, outcome_reason, created_at, tweet_id"),
  "id",
  { label: "report.allPipelineRuns" },
);
// Fill in the default pick for every A/B test. Without this a row written before a test
// existed would get a different variant label from a row written after it.
for (const r of rawPipelineRunsFull) {
  r.ab_test_picks = resolvePicks(r.ab_test_picks);
}
console.log(`  ${rawPipelineRunsFull.length} pipeline runs`);

function variantLabel(bot_name: string | null, picks: Record<string, string> | null): string {
  if (!bot_name) return "unknown";
  if (!picks) return bot_name;
  const variantTags = Object.entries(picks)
    .filter(([k]) => k !== "bot")
    .map(([, v]) => v);
  return variantTags.length === 0 ? bot_name : `${bot_name}_${variantTags.join("-")}`;
}

// Work out which runs are retries. For a given tweet the run with the earliest
// created_at is the first try. Every later run on that tweet is a retry.
const firstSeenByTweet = new Map<string, string>();
for (const r of rawPipelineRunsFull) {
  const prev = firstSeenByTweet.get(r.tweet_id);
  if (!prev || r.created_at < prev) firstSeenByTweet.set(r.tweet_id, r.created_at);
}
const pipelineRuns = rawPipelineRunsFull.map(r => ({
  bot_id: variantLabel(r.bot_name, r.ab_test_picks),
  outcome: r.outcome,
  outcome_reason: r.outcome_reason,
  created_at: r.created_at,
  is_retry: r.created_at !== firstSeenByTweet.get(r.tweet_id),
}));

// 5. The video information, which now lives on the tweets table. It used to sit on
// pipeline_runs. Only tweets that had a submitted run are of interest here. The fetch
// runs in batches so that the IN clause stays under the URI length limit.
const submittedTweetIds = new Set(
  rawPipelineRunsFull.filter(r => r.outcome === "submitted").map(r => r.tweet_id)
);
const submittedTweetIdsArr = [...submittedTweetIds];
const videoRuns = await fetchInBatches<{ tweet_id: string; has_video: boolean | null; video_duration_ms: number | null }>(
  (chunk) => client.from("tweets").select("tweet_id, has_video, video_duration_ms").in("tweet_id", chunk),
  submittedTweetIdsArr,
  { label: "report.videoTweets" },
);
const videoByTweet = new Map<string, { has_video: boolean; video_duration_ms: number | null }>();
for (const r of videoRuns) {
  if (r.tweet_id && r.has_video !== null) {
    videoByTweet.set(r.tweet_id, { has_video: r.has_video, video_duration_ms: r.video_duration_ms });
  }
}
console.log(`  ${videoRuns.length} tweets with video info`);

const competingData = await fetchAllRows<{
  id: string;
  tweet_id: string;
  note_id: string;
  our_note_id: string;
  current_status: string | null;
}>(
  () => client.from("competing_notes").select("id, tweet_id, note_id, our_note_id, current_status"),
  "id",
  { label: "report.competingNotes" },
);
const totalCompeting = competingData.length;
const helpfulCompeting = competingData.filter(c => c.current_status === "CURRENTLY_RATED_HELPFUL").length;
console.log(`  ${totalCompeting} competing notes (${helpfulCompeting} helpful)`);

// Build the note id to bot name lookup out of the submitted pipeline runs. There is one
// run per submission attempt, so a note that was retried can appear more than once. The
// last run we walk over wins. That is good enough for deciding which bot owns a note.
const botNameByNoteId = new Map<string, string>();
for (const r of botRuns) {
  if (r.note_id && r.bot_name) botNameByNoteId.set(r.note_id, r.bot_name);
}

const notes = scrapedNotes.map((n) => {
  let noteDate: string;
  if (n.submitted_at) {
    noteDate = n.submitted_at;
  } else {
    try {
      noteDate = snowflakeToDate(n.note_id).toISOString();
    } catch {
      noteDate = n.first_seen_at;
    }
  }
  return {
    note_id: n.note_id,
    cn_status: n.cn_status || "UNKNOWN",
    view_count: n.view_count || 0,
    bot_name: botNameByNoteId.get(n.note_id) || "pre-tracking",
    submitted_at: noteDate,
    has_video: videoByTweet.get(n.tweet_id)?.has_video ?? false,
    video_duration_ms: videoByTweet.get(n.tweet_id)?.video_duration_ms ?? null,
  };
});

const activeBots = ["multi-agent", "simple-bot", "agent", "cheap-bot"];
const legacyBots = [
  "claude-simple",  // Renamed to "simple-bot" by migration 039, which also renamed every existing row.
  "opus-main", "opus-main-v2", "opus-direct", "opus-direct-grok",
  "opus-main-v2-grok", "opus-main-no-source-check", "opus-multi-source",
  "opus-bridging", "opus-4.6", "sonar-pro", "kimi-k2", "opus-research",
  "opus-verified", "opus-concise", "opus-scored", "opus-strict",
  "gemini-flash", "multi-search", "gemini-3-flash", "deepseek", "pre-tracking",
];

const knownBots = new Set([...activeBots, ...legacyBots]);
const unknownBotNotes = notes.filter((n) => !knownBots.has(n.bot_name));
if (unknownBotNotes.length > 0) {
  const unknownBots = [...new Set(unknownBotNotes.map((n) => n.bot_name))];
  throw new Error(
    `Found ${unknownBotNotes.length} notes from unknown bots: ${unknownBots.join(", ")}. Add them to activeBots or legacyBots in generateMainReport.ts`
  );
}

const pipelineOutcomesByBot: Record<string, { note_not_needed: number; failed_to_write: number }> = {};
for (const row of pipelineRuns) {
  const bot = row.bot_id || "unknown";
  if (!pipelineOutcomesByBot[bot]) pipelineOutcomesByBot[bot] = { note_not_needed: 0, failed_to_write: 0 };
  if (row.outcome === "rejected") pipelineOutcomesByBot[bot].note_not_needed++;
  if (row.outcome === "failed") pipelineOutcomesByBot[bot].failed_to_write++;
}

// This total covers every note. The filters the page offers never narrow it.
const globalTotalViews = scrapedNotes.reduce((sum, n) => sum + (n.view_count || 0), 0);

// These are the only note fields the page embeds. The charts in the browser read them.
const notesData = notes.map((n) => ({
  bot_name: n.bot_name,
  submitted_at: n.submitted_at,
  cn_status: n.cn_status,
  view_count: n.view_count,
  has_video: n.has_video,
  video_duration_ms: n.video_duration_ms,
}));

const botColors: Record<string, string> = {
  "opus-main": "rgba(59, 130, 246, 0.8)",
  "opus-main-v2": "rgba(99, 102, 241, 0.8)",
  "opus-direct": "rgba(234, 88, 12, 0.8)",
  "opus-direct-grok": "rgba(220, 38, 38, 0.8)",
  "opus-main-v2-grok": "rgba(20, 184, 166, 0.8)",
  "opus-4.6": "rgba(99, 102, 241, 0.5)",
  "sonar-pro": "rgba(20, 184, 166, 0.5)",
  "kimi-k2": "rgba(245, 158, 11, 0.5)",
  "opus-research": "rgba(236, 72, 153, 0.5)",
  "opus-verified": "rgba(139, 92, 246, 0.5)",
  "opus-concise": "rgba(34, 197, 94, 0.5)",
  "opus-scored": "rgba(168, 85, 247, 0.5)",
  "opus-strict": "rgba(107, 114, 128, 0.5)",
  "gemini-flash": "rgba(245, 158, 11, 0.5)",
  "multi-search": "rgba(20, 184, 166, 0.5)",
  "gemini-3-flash": "rgba(236, 72, 153, 0.5)",
  "deepseek": "rgba(239, 68, 68, 0.5)",
  "pre-tracking": "rgba(156, 163, 175, 0.5)",
};

const chartColors = [
  "rgba(59, 130, 246, 0.8)",
  "rgba(34, 197, 94, 0.8)",
  "rgba(168, 85, 247, 0.8)",
  "rgba(20, 184, 166, 0.8)",
  "rgba(245, 158, 11, 0.8)",
  "rgba(239, 68, 68, 0.8)",
  "rgba(107, 114, 128, 0.8)",
  "rgba(236, 72, 153, 0.8)",
];

console.log(`Building report with ${notes.length} notes, ${globalTotalViews.toLocaleString()} total views...`);

const html = `<!DOCTYPE html>
<html>
<head>
  <title>Community Notes Bot Performance</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-chart-sankey"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 1000px;
      margin: 40px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 { color: #333; margin-bottom: 10px; }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
    }
    .subtitle { color: #666; margin: 0; }
    .filter-group {
      display: flex;
      gap: 8px;
    }
    .filter-group button {
      padding: 8px 16px;
      border: 1px solid #ddd;
      background: white;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9em;
      transition: all 0.2s;
    }
    .filter-group button:hover { background: #f0f0f0; }
    .filter-group button.active {
      background: #3b82f6;
      color: white;
      border-color: #3b82f6;
    }
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
      margin-bottom: 30px;
    }
    .card {
      background: white;
      padding: 15px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .card-label { color: #666; font-size: 0.85em; }
    .card-sub { color: #999; font-size: 0.75em; margin-top: 2px; }
    .card-value { font-size: 1.8em; font-weight: bold; margin: 5px 0; }
    .card-value.green { color: #22c55e; }
    .card-value.blue { color: #3b82f6; }
    .card-value.yellow { color: #f59e0b; }
    .card-value.purple { color: #8b5cf6; }
    .chart-container {
      background: white;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-bottom: 20px;
    }
    .chart-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    .chart-title { font-weight: 600; color: #333; margin-bottom: 15px; }
    .section-title {
      font-weight: 600;
      color: #333;
      margin: 30px 0 15px 0;
      font-size: 1.1em;
    }
    canvas { max-height: 280px; }
    .summary {
      background: white;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-top: 20px;
    }
    .summary h2 { margin-top: 0; color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { font-weight: 600; color: #333; }
    td { color: #666; }
    .helpful { color: #22c55e; }
    .not-helpful { color: #ef4444; }
    .needs-more { color: #6b7280; }
    .pct { color: #999; font-size: 0.9em; }
    .legacy { color: #9ca3af; font-weight: normal; font-size: 0.85em; }
    .legacy-row { opacity: 0.7; }
    .data-source { color: #999; font-size: 0.8em; margin-top: 20px; text-align: right; }
  </style>
</head>
<body>
  <h1>Community Notes Bot Performance</h1>

  <div class="summary" style="margin-bottom: 20px; padding: 12px 20px;">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <strong style="color: #333;">Current Bot Weights</strong>
      <div style="display: flex; gap: 16px; font-size: 0.9em;">
        <span><strong>opus-main</strong> 40%</span>
        <span><strong>opus-main-v2</strong> 40%</span>
        <span><strong>opus-direct</strong> 7%</span>
        <span><strong>opus-direct-grok</strong> 7%</span>
        <span><strong>opus-main-v2-grok</strong> 6%</span>
      </div>
    </div>
  </div>

  <div class="header-row">
    <p class="subtitle">Data from notes + public data</p>
    <div style="display: flex; gap: 16px; align-items: center;">
      <div>
        <span style="color: #666; font-size: 0.85em; margin-right: 8px;">Time:</span>
        <span class="filter-group">
          <button onclick="setTimeFilter('all')" id="btn-all" class="active">All</button>
          <button onclick="setTimeFilter('month')" id="btn-month">30d</button>
          <button onclick="setTimeFilter('week')" id="btn-week">7d</button>
        </span>
      </div>
      <div>
        <span style="color: #666; font-size: 0.85em; margin-right: 8px;">Video:</span>
        <span class="filter-group">
          <button onclick="setVideoFilter('all')" id="btn-vid-all" class="active">All</button>
          <button onclick="setVideoFilter('no-video')" id="btn-vid-no">No Video</button>
          <button onclick="setVideoFilter('video')" id="btn-vid-yes">Video</button>
          <button onclick="setVideoFilter('tiktok')" id="btn-vid-tiktok">TikTok Style</button>
        </span>
      </div>
      <div>
        <span style="color: #666; font-size: 0.85em; margin-right: 8px;">Attempts:</span>
        <span class="filter-group">
          <button onclick="setRetryFilter('all')" id="btn-retry-all" class="active">All</button>
          <button onclick="setRetryFilter('first')" id="btn-retry-first">First Try</button>
          <button onclick="setRetryFilter('retry')" id="btn-retry-retry">Retries</button>
        </span>
      </div>
    </div>
  </div>

  <div class="summary-cards" style="grid-template-columns: repeat(6, 1fr);">
    <div class="card">
      <div class="card-label">Total Notes</div>
      <div class="card-value blue" id="total-notes">-</div>
    </div>
    <div class="card">
      <div class="card-label">Helpful Rate</div>
      <div class="card-value green" id="helpful-rate">-</div>
      <div class="card-sub" id="helpful-sub"></div>
    </div>
    <div class="card">
      <div class="card-label">Total Views</div>
      <div class="card-value purple" id="total-views">-</div>
      <div class="card-sub" id="views-sub">across filtered notes</div>
    </div>
    <div class="card">
      <div class="card-label">Awaiting Ratings</div>
      <div class="card-value yellow" id="awaiting-ratings">-</div>
    </div>
    <div class="card">
      <div class="card-label">Competing Notes</div>
      <div class="card-value" style="color: #ef4444;" id="competing-count">-</div>
      <div class="card-sub" id="competing-sub"></div>
    </div>
  </div>

  <div class="section-title">Active Bots</div>
  <div class="chart-row">
    <div class="chart-container">
      <div class="chart-title">Status by Bot (counts)</div>
      <canvas id="activeStatusChart"></canvas>
    </div>
    <div class="chart-container">
      <div class="chart-title">Status Breakdown %</div>
      <canvas id="rateChart"></canvas>
    </div>
  </div>

  <div class="section-title">Legacy Bots</div>
  <div class="chart-row">
    <div class="chart-container">
      <div class="chart-title">Status by Bot (counts)</div>
      <canvas id="legacyStatusChart"></canvas>
    </div>
    <div class="chart-container">
      <div class="chart-title">Status Breakdown %</div>
      <canvas id="legacyRateChart"></canvas>
    </div>
  </div>

  <div class="section-title">All Outcomes by Bot</div>
  <div class="chart-container">
    <div class="chart-title">Submitted + Rejected + Failed</div>
    <canvas id="pipelineOutcomesChart"></canvas>
  </div>

  <div class="section-title">Weekly Helpful vs Not Helpful</div>
  <div class="chart-container">
    <div class="chart-title">Count of Helpful / Not Helpful notes per week (line = net helpful)</div>
    <canvas id="weeklyRateChart"></canvas>
  </div>

  <div class="section-title">Notes Per Week</div>
  <div class="chart-container">
    <div class="chart-title">Notes Created Per Week (Stacked by Bot)</div>
    <canvas id="weeklyNotesChart"></canvas>
  </div>

  <div class="section-title">Pipeline Flow by Bot</div>
  <div id="sankey-container"></div>

  <div class="summary">
    <h2>Pipeline Attempts</h2>
    <table>
      <thead>
        <tr>
          <th>Bot</th>
          <th>Attempted</th>
          <th class="helpful">Submitted</th>
          <th class="needs-more">Filtered</th>
          <th class="not-helpful">Failed</th>
          <th class="not-helpful">Rejected</th>
          <th>Submit Rate</th>
          <th>Top Rejection Reason</th>
        </tr>
      </thead>
      <tbody id="pipeline-table-body">
      </tbody>
    </table>
  </div>

  <p class="data-source">Generated ${new Date().toISOString().slice(0, 16)} UTC</p>

  <script>
    const allNotes = ${JSON.stringify(notesData)};
    const activeBots = ${JSON.stringify(activeBots)};
    const legacyBots = ${JSON.stringify(legacyBots)};
    const chartColors = ${JSON.stringify(chartColors)};
    const botColors = ${JSON.stringify(botColors)};
    const pipelineRuns = ${JSON.stringify(pipelineRuns)};
    const pipelineOutcomesByBot = ${JSON.stringify(pipelineOutcomesByBot)};
    const globalTotalViews = ${globalTotalViews};
    const totalCompeting = ${totalCompeting};
    const helpfulCompeting = ${helpfulCompeting};

    let rateChart, activeStatusChart, legacyStatusChart, legacyRateChart, pipelineOutcomesChart, weeklyRateChart, weeklyNotesChart;
    let currentTimeFilter = 'all';
    let currentVideoFilter = 'all';
    let currentRetryFilter = 'all';

    function formatViews(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
      if (n >= 1000) return Math.round(n / 1000) + "K";
      return n.toString();
    }

    function getStatus(status) {
      const s = (status || "").toUpperCase().replace(/\\s+/g, "_");
      if (s === "CURRENTLY_RATED_HELPFUL") return "helpful";
      if (s === "CURRENTLY_RATED_NOT_HELPFUL") return "notHelpful";
      if (s === "NEEDS_MORE_RATINGS") return "needsMore";
      return "unknown";
    }

    function computeStats(notes, botList) {
      const stats = {};
      for (const bot of botList) {
        stats[bot] = { total: 0, helpful: 0, notHelpful: 0, needsMore: 0, unknown: 0, views: 0 };
      }
      for (const note of notes) {
        if (!stats[note.bot_name]) continue;
        stats[note.bot_name].total++;
        stats[note.bot_name].views += note.view_count || 0;
        stats[note.bot_name][getStatus(note.cn_status)]++;
      }
      return stats;
    }

    function filterNotes(timeFilter, videoFilter) {
      let filtered = allNotes;
      const now = new Date();
      if (timeFilter === 'week') {
        const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        filtered = filtered.filter(n => new Date(n.submitted_at) >= cutoff);
      } else if (timeFilter === 'month') {
        const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        filtered = filtered.filter(n => new Date(n.submitted_at) >= cutoff);
      }
      if (videoFilter === 'video') {
        filtered = filtered.filter(n => n.has_video);
      } else if (videoFilter === 'no-video') {
        filtered = filtered.filter(n => !n.has_video);
      } else if (videoFilter === 'tiktok') {
        filtered = filtered.filter(n => n.has_video && n.video_duration_ms && n.video_duration_ms >= 10000 && n.video_duration_ms <= 120000);
      }
      return filtered;
    }

    function setTimeFilter(filter) {
      currentTimeFilter = filter;
      document.querySelectorAll('#btn-all, #btn-month, #btn-week').forEach(b => b.classList.remove('active'));
      document.getElementById('btn-' + filter).classList.add('active');
      updateCharts();
    }

    function setVideoFilter(filter) {
      currentVideoFilter = filter;
      document.querySelectorAll('#btn-vid-all, #btn-vid-no, #btn-vid-yes, #btn-vid-tiktok').forEach(b => b.classList.remove('active'));
      const btnId = filter === 'all' ? 'btn-vid-all' : filter === 'no-video' ? 'btn-vid-no' : filter === 'tiktok' ? 'btn-vid-tiktok' : 'btn-vid-yes';
      document.getElementById(btnId).classList.add('active');
      updateCharts();
    }

    function setRetryFilter(filter) {
      currentRetryFilter = filter;
      document.querySelectorAll('#btn-retry-all, #btn-retry-first, #btn-retry-retry').forEach(b => b.classList.remove('active'));
      document.getElementById('btn-retry-' + filter).classList.add('active');
      renderPipelineTable();
      renderSankeys();
    }

    function filterPipelineRuns() {
      let runs = pipelineRuns;
      const now = new Date();
      if (currentTimeFilter === 'week') {
        const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        runs = runs.filter(r => new Date(r.created_at) >= cutoff);
      } else if (currentTimeFilter === 'month') {
        const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        runs = runs.filter(r => new Date(r.created_at) >= cutoff);
      }
      if (currentRetryFilter === 'first') {
        runs = runs.filter(r => !r.is_retry);
      } else if (currentRetryFilter === 'retry') {
        runs = runs.filter(r => r.is_retry);
      }
      return runs;
    }

    function updateCharts() {
      const filtered = filterNotes(currentTimeFilter, currentVideoFilter);
      const activeStats = computeStats(filtered, activeBots);
      const legacyStats = computeStats(filtered, legacyBots);

      // Compute totals
      let totalNotes = 0, totalHelpful = 0, totalNotHelpful = 0, totalNeedsMore = 0, totalViews = 0;
      for (const bot of [...activeBots, ...legacyBots]) {
        const s = activeStats[bot] || legacyStats[bot];
        if (s) {
          totalNotes += s.total;
          totalHelpful += s.helpful;
          totalNotHelpful += s.notHelpful;
          totalNeedsMore += s.needsMore;
          totalViews += s.views;
        }
      }
      const knownTotal = totalHelpful + totalNotHelpful + totalNeedsMore;
      const helpfulRate = knownTotal > 0 ? ((totalHelpful / knownTotal) * 100).toFixed(1) : "N/A";

      // Update cards
      document.getElementById('total-notes').textContent = totalNotes;
      document.getElementById('helpful-rate').textContent = helpfulRate + '%';
      document.getElementById('helpful-sub').textContent = totalHelpful + ' of ' + knownTotal + ' rated';
      document.getElementById('total-views').textContent = formatViews(totalViews);
      document.getElementById('awaiting-ratings').textContent = totalNeedsMore;
      document.getElementById('competing-count').textContent = totalCompeting;
      document.getElementById('competing-sub').textContent = helpfulCompeting + ' helpful';

      // Sort bots by total
      const sortedActive = [...activeBots].sort((a, b) => (activeStats[b]?.total || 0) - (activeStats[a]?.total || 0));
      const sortedLegacy = [...legacyBots].sort((a, b) => (legacyStats[b]?.total || 0) - (legacyStats[a]?.total || 0));

      // Status Breakdown % (active only)
      const activeKnown = sortedActive.map(b => {
        const s = activeStats[b];
        return s ? s.helpful + s.notHelpful + s.needsMore : 0;
      });
      if (rateChart) rateChart.destroy();
      rateChart = new Chart(document.getElementById('rateChart'), {
        type: 'bar',
        data: {
          labels: sortedActive,
          datasets: [
            { label: 'Helpful', data: sortedActive.map((b, i) => activeKnown[i] > 0 ? ((activeStats[b]?.helpful || 0) / activeKnown[i] * 100).toFixed(1) : 0), backgroundColor: 'rgba(34, 197, 94, 0.8)' },
            { label: 'Not Helpful', data: sortedActive.map((b, i) => activeKnown[i] > 0 ? ((activeStats[b]?.notHelpful || 0) / activeKnown[i] * 100).toFixed(1) : 0), backgroundColor: 'rgba(239, 68, 68, 0.8)' },
            { label: 'Needs More', data: sortedActive.map((b, i) => activeKnown[i] > 0 ? ((activeStats[b]?.needsMore || 0) / activeKnown[i] * 100).toFixed(1) : 0), backgroundColor: 'rgba(245, 158, 11, 0.8)' }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom' } },
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, max: 100, title: { display: true, text: '%' } } }
        }
      });

      // Active bots status chart
      if (activeStatusChart) activeStatusChart.destroy();
      activeStatusChart = new Chart(document.getElementById('activeStatusChart'), {
        type: 'bar',
        data: {
          labels: sortedActive,
          datasets: [
            { label: 'Helpful', data: sortedActive.map(b => activeStats[b]?.helpful || 0), backgroundColor: 'rgba(34, 197, 94, 0.8)' },
            { label: 'Not Helpful', data: sortedActive.map(b => activeStats[b]?.notHelpful || 0), backgroundColor: 'rgba(239, 68, 68, 0.8)' },
            { label: 'Needs More', data: sortedActive.map(b => activeStats[b]?.needsMore || 0), backgroundColor: 'rgba(245, 158, 11, 0.8)' },
            { label: 'Unknown', data: sortedActive.map(b => activeStats[b]?.unknown || 0), backgroundColor: 'rgba(209, 213, 219, 0.8)' }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom' } },
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
        }
      });

      // Legacy bots status chart
      if (legacyStatusChart) legacyStatusChart.destroy();
      legacyStatusChart = new Chart(document.getElementById('legacyStatusChart'), {
        type: 'bar',
        data: {
          labels: sortedLegacy,
          datasets: [
            { label: 'Helpful', data: sortedLegacy.map(b => legacyStats[b]?.helpful || 0), backgroundColor: 'rgba(34, 197, 94, 0.8)' },
            { label: 'Not Helpful', data: sortedLegacy.map(b => legacyStats[b]?.notHelpful || 0), backgroundColor: 'rgba(239, 68, 68, 0.8)' },
            { label: 'Needs More', data: sortedLegacy.map(b => legacyStats[b]?.needsMore || 0), backgroundColor: 'rgba(245, 158, 11, 0.8)' },
            { label: 'Unknown', data: sortedLegacy.map(b => legacyStats[b]?.unknown || 0), backgroundColor: 'rgba(209, 213, 219, 0.8)' }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom' } },
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
        }
      });

      // Legacy bots status breakdown %
      const legacyKnown = sortedLegacy.map(b => {
        const s = legacyStats[b];
        return s ? s.helpful + s.notHelpful + s.needsMore : 0;
      });
      if (legacyRateChart) legacyRateChart.destroy();
      legacyRateChart = new Chart(document.getElementById('legacyRateChart'), {
        type: 'bar',
        data: {
          labels: sortedLegacy,
          datasets: [
            { label: 'Helpful', data: sortedLegacy.map((b, i) => legacyKnown[i] > 0 ? ((legacyStats[b]?.helpful || 0) / legacyKnown[i] * 100).toFixed(1) : 0), backgroundColor: 'rgba(34, 197, 94, 0.8)' },
            { label: 'Not Helpful', data: sortedLegacy.map((b, i) => legacyKnown[i] > 0 ? ((legacyStats[b]?.notHelpful || 0) / legacyKnown[i] * 100).toFixed(1) : 0), backgroundColor: 'rgba(239, 68, 68, 0.8)' },
            { label: 'Needs More', data: sortedLegacy.map((b, i) => legacyKnown[i] > 0 ? ((legacyStats[b]?.needsMore || 0) / legacyKnown[i] * 100).toFixed(1) : 0), backgroundColor: 'rgba(245, 158, 11, 0.8)' }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom' } },
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, max: 100, title: { display: true, text: '%' } } }
        }
      });

      // Pipeline outcomes chart
      if (pipelineOutcomesChart) pipelineOutcomesChart.destroy();
      const allBotsForOutcomes = [...activeBots, ...legacyBots].filter(b => b !== 'pre-tracking');
      const combinedStats = {};
      for (const bot of allBotsForOutcomes) {
        const noteStats = activeStats[bot] || legacyStats[bot] || { helpful: 0, notHelpful: 0, needsMore: 0 };
        const po = pipelineOutcomesByBot[bot] || { note_not_needed: 0, failed_to_write: 0 };
        combinedStats[bot] = {
          helpful: noteStats.helpful || 0,
          notHelpful: noteStats.notHelpful || 0,
          needsMore: noteStats.needsMore || 0,
          noteNotNeeded: po.note_not_needed || 0,
          failedToWrite: po.failed_to_write || 0,
        };
      }
      pipelineOutcomesChart = new Chart(document.getElementById('pipelineOutcomesChart'), {
        type: 'bar',
        data: {
          labels: allBotsForOutcomes,
          datasets: [
            { label: 'Helpful', data: allBotsForOutcomes.map(b => combinedStats[b].helpful), backgroundColor: 'rgba(34, 197, 94, 0.8)' },
            { label: 'Not Helpful', data: allBotsForOutcomes.map(b => combinedStats[b].notHelpful), backgroundColor: 'rgba(239, 68, 68, 0.8)' },
            { label: 'Needs More', data: allBotsForOutcomes.map(b => combinedStats[b].needsMore), backgroundColor: 'rgba(245, 158, 11, 0.8)' },
            { label: 'Note Not Needed', data: allBotsForOutcomes.map(b => combinedStats[b].noteNotNeeded), backgroundColor: 'rgba(59, 130, 246, 0.8)' },
            { label: 'Failed to Write', data: allBotsForOutcomes.map(b => combinedStats[b].failedToWrite), backgroundColor: 'rgba(156, 163, 175, 0.8)' }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom' } },
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
        }
      });

      // Weekly helpful vs not helpful chart (counts + net helpful line)
      if (weeklyRateChart) weeklyRateChart.destroy();
      const byWeek = {};
      function getWeekLabel(dateStr) {
        const d = new Date(dateStr);
        const day = d.getDay();
        const monday = new Date(d);
        monday.setDate(d.getDate() - ((day + 6) % 7));
        return monday.toISOString().slice(0, 10);
      }
      for (const note of filtered) {
        const week = getWeekLabel(note.submitted_at);
        if (!byWeek[week]) byWeek[week] = { helpful: 0, notHelpful: 0, needsMore: 0, total: 0 };
        byWeek[week].total++;
        const s = getStatus(note.cn_status);
        if (s === 'helpful') byWeek[week].helpful++;
        else if (s === 'notHelpful') byWeek[week].notHelpful++;
        else if (s === 'needsMore') byWeek[week].needsMore++;
      }
      const weeks = Object.keys(byWeek).sort();
      weeklyRateChart = new Chart(document.getElementById('weeklyRateChart'), {
        type: 'bar',
        data: {
          labels: weeks,
          datasets: [
            {
              label: 'Helpful',
              data: weeks.map(w => byWeek[w].helpful),
              backgroundColor: 'rgba(34, 197, 94, 0.8)',
              order: 2,
            },
            {
              label: 'Not Helpful',
              data: weeks.map(w => -byWeek[w].notHelpful),
              backgroundColor: 'rgba(239, 68, 68, 0.8)',
              order: 2,
            },
            {
              label: 'Net Helpful',
              data: weeks.map(w => byWeek[w].helpful - byWeek[w].notHelpful),
              type: 'line',
              borderColor: 'rgba(59, 130, 246, 1)',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              borderWidth: 2,
              pointRadius: 3,
              fill: false,
              order: 1,
            }
          ]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom' },
            tooltip: {
              callbacks: {
                afterLabel: function(ctx) {
                  const w = weeks[ctx.dataIndex];
                  const b = byWeek[w];
                  return b.helpful + ' helpful, ' + b.notHelpful + ' not helpful, ' + b.needsMore + ' pending (' + b.total + ' total)';
                }
              }
            }
          },
          scales: {
            x: { stacked: true, ticks: { maxRotation: 45 } },
            y: { stacked: true, title: { display: true, text: 'Notes (negative = not helpful)' } }
          }
        }
      });

      // Weekly notes chart (stacked by bot, same week bucketing as helpful chart)
      if (weeklyNotesChart) weeklyNotesChart.destroy();
      const byWeekBot = {};
      const weeklyBotSet = new Set();
      for (const note of filtered) {
        const week = getWeekLabel(note.submitted_at);
        const bot = note.bot_name;
        weeklyBotSet.add(bot);
        if (!byWeekBot[week]) byWeekBot[week] = {};
        byWeekBot[week][bot] = (byWeekBot[week][bot] || 0) + 1;
      }
      const noteWeeks = Object.keys(byWeekBot).sort();
      const weeklyBotList = [...weeklyBotSet].sort();
      weeklyNotesChart = new Chart(document.getElementById('weeklyNotesChart'), {
        type: 'bar',
        data: {
          labels: noteWeeks,
          datasets: weeklyBotList.map(bot => ({
            label: bot,
            data: noteWeeks.map(w => byWeekBot[w]?.[bot] || 0),
            backgroundColor: botColors[bot] || 'rgba(107, 114, 128, 0.8)',
          }))
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom' } },
          scales: { x: { stacked: true, ticks: { maxRotation: 45 } }, y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Notes' } } }
        }
      });

      // Update pipeline table + sankeys
      renderPipelineTable();
      renderSankeys();
    }

    function renderPipelineTable() {
      const tbody = document.getElementById('pipeline-table-body');
      tbody.innerHTML = '';

      const runs = filterPipelineRuns();

      const byBot = {};
      for (const r of runs) {
        if (!byBot[r.bot_id]) byBot[r.bot_id] = { total: 0, submitted: 0, filtered: 0, failed: 0, rejected: 0 };
        byBot[r.bot_id].total++;
        if (r.outcome in byBot[r.bot_id]) byBot[r.bot_id][r.outcome]++;
      }

      // Build top rejection reason per bot from filtered runs
      const reasonsByBot = {};
      for (const r of runs) {
        if (r.outcome !== 'rejected' && r.outcome !== 'failed') continue;
        const reason = r.outcome_reason || r.outcome;
        if (!reasonsByBot[r.bot_id]) reasonsByBot[r.bot_id] = {};
        reasonsByBot[r.bot_id][reason] = (reasonsByBot[r.bot_id][reason] || 0) + 1;
      }
      function getTopReason(botId) {
        const reasons = reasonsByBot[botId];
        if (!reasons) return '-';
        const sorted = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
        if (sorted.length === 0) return '-';
        const [reason, count] = sorted[0];
        const label = reason.replace(/_/g, ' ');
        return label + ' (' + count + ')';
      }

      const allBotIds = [...activeBots, ...legacyBots].filter(b => b !== 'pre-tracking');
      let grandTotal = 0, grandSubmitted = 0, grandFiltered = 0, grandFailed = 0, grandRejected = 0;

      for (const bot of allBotIds) {
        const p = byBot[bot];
        if (!p || p.total === 0) continue;
        const submitRate = p.total > 0 ? Math.round(p.submitted / p.total * 100) : 0;
        const isLegacy = legacyBots.includes(bot);
        grandTotal += p.total;
        grandSubmitted += p.submitted;
        grandFiltered += p.filtered;
        grandFailed += p.failed;
        grandRejected += p.rejected;

        tbody.innerHTML += \`<tr class="\${isLegacy ? 'legacy-row' : ''}">
          <td><strong>\${bot}\${isLegacy ? ' <span class="legacy">(legacy)</span>' : ''}</strong></td>
          <td>\${p.total}</td>
          <td class="helpful">\${p.submitted}</td>
          <td class="needs-more">\${p.filtered}</td>
          <td class="not-helpful">\${p.failed}</td>
          <td class="not-helpful">\${p.rejected}</td>
          <td>\${submitRate}%</td>
          <td style="font-size: 0.85em; color: #888;">\${getTopReason(bot)}</td>
        </tr>\`;
      }

      const grandSubmitRate = grandTotal > 0 ? Math.round(grandSubmitted / grandTotal * 100) : 0;
      tbody.innerHTML += \`<tr style="font-weight: bold; border-top: 2px solid #333;">
        <td>Total</td>
        <td>\${grandTotal}</td>
        <td class="helpful">\${grandSubmitted}</td>
        <td class="needs-more">\${grandFiltered}</td>
        <td class="not-helpful">\${grandFailed}</td>
        <td class="not-helpful">\${grandRejected}</td>
        <td>\${grandSubmitRate}%</td>
        <td></td>
      </tr>\`;
    }

    // Sankey diagrams per active bot
    const sankeyCharts = [];
    const sankeyColors = {
      'Attempts': 'rgba(107, 114, 128, 0.7)',
      'submitted': 'rgba(34, 197, 94, 0.7)',
      'rejected': 'rgba(239, 68, 68, 0.7)',
      'failed': 'rgba(245, 158, 11, 0.7)',
      'filtered': 'rgba(156, 163, 175, 0.7)',
      'no_correction_needed': 'rgba(59, 130, 246, 0.5)',
      'check_failed': 'rgba(220, 38, 38, 0.5)',
      'low_evaluation_score': 'rgba(168, 85, 247, 0.5)',
      'scoring_filters_failed': 'rgba(236, 72, 153, 0.5)',
      'source_trust_failed': 'rgba(234, 88, 12, 0.5)',
      'bot_error': 'rgba(245, 158, 11, 0.5)',
      'all_bots_failed': 'rgba(202, 138, 4, 0.5)',
      'submission_error': 'rgba(239, 68, 68, 0.5)',
      'video_cap_exceeded': 'rgba(107, 114, 128, 0.5)',
    };

    function renderSankeys() {
      const container = document.getElementById('sankey-container');
      container.innerHTML = '';

      // Destroy old sankey charts
      for (const c of sankeyCharts) c.destroy();
      sankeyCharts.length = 0;

      const allFilteredRuns = filterPipelineRuns();

      for (const botId of activeBots) {
        const botRuns = allFilteredRuns.filter(r => r.bot_id === botId);
        if (botRuns.length === 0) continue;

        // Count flows: attempts → outcome → reason
        const outcomeCounts = {};
        const reasonCounts = {};
        for (const r of botRuns) {
          outcomeCounts[r.outcome] = (outcomeCounts[r.outcome] || 0) + 1;
          const reason = r.outcome_reason || '(none)';
          const key = r.outcome + '→' + reason;
          reasonCounts[key] = (reasonCounts[key] || 0) + 1;
        }

        const flows = [];
        // Level 1: Attempts → outcome
        for (const [outcome, count] of Object.entries(outcomeCounts)) {
          flows.push({ from: 'Attempts', to: outcome, flow: count });
        }
        // Level 2: outcome → reason (skip if reason is null/none and there's only one reason)
        for (const [key, count] of Object.entries(reasonCounts)) {
          const [outcome, reason] = key.split('→');
          if (reason && reason !== '(none)') {
            flows.push({ from: outcome, to: reason, flow: count });
          }
        }

        // Create card
        const card = document.createElement('div');
        card.className = 'chart-container';
        card.style.marginBottom = '20px';
        card.innerHTML = '<div class="chart-title">' + botId + ' (' + botRuns.length + ' attempts)</div>';
        const canvas = document.createElement('canvas');
        canvas.style.maxHeight = '200px';
        card.appendChild(canvas);
        container.appendChild(card);

        const chart = new Chart(canvas, {
          type: 'sankey',
          data: {
            datasets: [{
              data: flows,
              colorFrom: (c) => {
                const label = c.dataset.data[c.dataIndex].from;
                return sankeyColors[label] || 'rgba(107, 114, 128, 0.5)';
              },
              colorTo: (c) => {
                const label = c.dataset.data[c.dataIndex].to;
                return sankeyColors[label] || 'rgba(107, 114, 128, 0.5)';
              },
              colorMode: 'gradient',
              labels: {
                'Attempts': 'Attempts',
                'submitted': 'Submitted',
                'rejected': 'Rejected',
                'failed': 'Failed',
                'filtered': 'Filtered',
                'no_correction_needed': 'No correction needed',
                'check_failed': 'Check failed',
                'low_evaluation_score': 'Low eval score',
                'scoring_filters_failed': 'Scoring filters',
                'source_trust_failed': 'Source trust',
                'bot_error': 'Bot error',
                'all_bots_failed': 'All bots failed',
                'submission_error': 'Submit error',
                'video_cap_exceeded': 'Video filtered',
              },
              size: 'max',
            }]
          },
          options: {
            responsive: true,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    const item = ctx.dataset.data[ctx.dataIndex];
                    return item.from + ' → ' + item.to + ': ' + item.flow;
                  }
                }
              }
            }
          }
        });
        sankeyCharts.push(chart);
      }
    }

    // Initial render
    renderSankeys();
    updateCharts();
  </script>

  <p class="data-source">Generated ${new Date().toISOString().slice(0, 16)} UTC &mdash; <a href="https://github.com/user/cn-return-bot/blob/main/docs/main-report.md">Report docs</a></p>
</body>
</html>`;

if (!existsSync("tmp/reports")) {
  mkdirSync("tmp/reports", { recursive: true });
}

writeFileSync("tmp/reports/full-bot-report.html", html);
console.log("Report generated: tmp/reports/full-bot-report.html");

try {
  execSync("open tmp/reports/full-bot-report.html");
} catch {}
