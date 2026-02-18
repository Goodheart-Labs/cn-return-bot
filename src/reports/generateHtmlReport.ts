import "dotenv/config";
import { SupabaseLogger } from "../api/supabaseClient";
import { writeFileSync } from "fs";

const supabase = new SupabaseLogger();
const notes = await supabase.getNotesWithLatestSnapshots();

// Fetch pipeline run data per bot (attempts, outcomes) - aggregated for backward compat
const pipelineData = await supabase.getPipelineRunsByBot();

// Fetch raw pipeline runs with timestamps for client-side filtering
const pipelineRuns = await supabase.getPipelineRunsRaw();

// Fetch pipeline outcomes (rejected/failed) per bot
const pipelineOutcomes = await supabase.getPipelineOutcomesByBot();

// Fetch scraped note summary (non-junk reconciled data) for global stats
const scrapedSummary = await supabase.getScrapedNoteSummary();

// Define active vs legacy bots
const activeBots = ["opus-main-v2", "opus-4.6", "sonar-pro", "kimi-k2", "opus-research"];
const legacyBots = ["opus-main", "opus-scored", "gemini-flash", "multi-search", "gemini-3-flash", "deepseek", "opus-concise"];

// Check for notes from unknown bots
const knownBots = new Set([...activeBots, ...legacyBots]);
const unknownBotNotes = notes.filter(n => n.bot_name && !knownBots.has(n.bot_name));
if (unknownBotNotes.length > 0) {
  const unknownBots = [...new Set(unknownBotNotes.map(n => n.bot_name))];
  throw new Error(`Found ${unknownBotNotes.length} notes from unknown bots: ${unknownBots.join(", ")}. Add them to activeBots or legacyBots in generateHtmlReport.ts`);
}

// Compute notes per day by bot for daily chart
const dailyByDayBot: Record<string, Record<string, number>> = {};
for (const note of notes) {
  const day = note.submitted_at.slice(0, 10);
  const bot = note.bot_name || "unknown";
  if (!dailyByDayBot[day]) dailyByDayBot[day] = {};
  dailyByDayBot[day][bot] = (dailyByDayBot[day][bot] || 0) + 1;
}
const dailyDays = Object.keys(dailyByDayBot).sort();
const dailyBots = [...new Set(notes.map(n => n.bot_name || "unknown"))].sort();
const dailyBotColors: Record<string, string> = {
  "opus-main": "rgba(59, 130, 246, 0.8)",
  "opus-concise": "rgba(34, 197, 94, 0.8)",
  "gemini-flash": "rgba(245, 158, 11, 0.8)",
  "opus-scored": "rgba(168, 85, 247, 0.8)",
  "multi-search": "rgba(20, 184, 166, 0.8)",
  "gemini-3-flash": "rgba(236, 72, 153, 0.8)",
  "deepseek": "rgba(239, 68, 68, 0.8)",
  "unknown": "rgba(156, 163, 175, 0.8)",
};
const dailyDatasets = dailyBots.map(bot => ({
  label: bot,
  data: dailyDays.map(d => dailyByDayBot[d]?.[bot] || 0),
  backgroundColor: dailyBotColors[bot] || "rgba(107, 114, 128, 0.8)",
}));

// Format notes data for client-side rendering
const notesData = notes.map((note) => ({
  bot_name: note.bot_name || "unknown",
  submitted_at: note.submitted_at,
  effective_status: note.effective_status,
  view_count: note.view_count || 0,
  has_video: note.has_video ?? null,
}));

const colors = [
  "rgba(59, 130, 246, 0.8)",
  "rgba(34, 197, 94, 0.8)",
  "rgba(168, 85, 247, 0.8)",
  "rgba(20, 184, 166, 0.8)",
  "rgba(245, 158, 11, 0.8)",
  "rgba(239, 68, 68, 0.8)",
  "rgba(107, 114, 128, 0.8)",
  "rgba(236, 72, 153, 0.8)",
];

const html = `<!DOCTYPE html>
<html>
<head>
  <title>Community Notes Bot Performance</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
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
    .filter-group button:hover {
      background: #f0f0f0;
    }
    .filter-group button.active {
      background: #3b82f6;
      color: white;
      border-color: #3b82f6;
    }
    .filters-row {
      display: flex;
      gap: 20px;
      align-items: center;
    }
    .filter-label {
      color: #666;
      font-size: 0.85em;
      margin-right: 8px;
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
    .generated { color: #666; margin-top: 20px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Community Notes Bot Performance</h1>
  <div class="header-row">
    <p class="subtitle">Status breakdown for each bot</p>
    <div class="filters-row">
      <div>
        <span class="filter-label">Time:</span>
        <span class="filter-group">
          <button onclick="setTimeFilter('all')" id="btn-all" class="active">All</button>
          <button onclick="setTimeFilter('month')" id="btn-month">30d</button>
          <button onclick="setTimeFilter('week')" id="btn-week">7d</button>
        </span>
      </div>
      <div>
        <span class="filter-label">Media:</span>
        <span class="filter-group">
          <button onclick="setMediaFilter('all')" id="btn-media-all" class="active">All</button>
          <button onclick="setMediaFilter('video')" id="btn-media-video">Video</button>
          <button onclick="setMediaFilter('no-video')" id="btn-media-no-video">No Video</button>
        </span>
      </div>
      <div>
        <span class="filter-label">Attempt:</span>
        <span class="filter-group">
          <button onclick="setAttemptFilter('all')" id="btn-attempt-all" class="active">All</button>
          <button onclick="setAttemptFilter('first')" id="btn-attempt-first">First Try</button>
          <button onclick="setAttemptFilter('retry')" id="btn-attempt-retry">Retry</button>
        </span>
      </div>
    </div>
  </div>

  <div class="summary-cards">
    <div class="card">
      <div class="card-label">Total Notes</div>
      <div class="card-value blue" id="total-notes">-</div>
    </div>
    <div class="card">
      <div class="card-label">Helpful Rate</div>
      <div class="card-value green" id="helpful-rate">-</div>
    </div>
    <div class="card">
      <div class="card-label">Total Views</div>
      <div class="card-value purple" id="total-views">-</div>
    </div>
    <div class="card">
      <div class="card-label">Awaiting Ratings</div>
      <div class="card-value yellow" id="awaiting-ratings">-</div>
    </div>
  </div>

  <div class="chart-row">
    <div class="chart-container">
      <div class="chart-title">Notes by Bot (Active)</div>
      <canvas id="notesChart"></canvas>
    </div>
    <div class="chart-container">
      <div class="chart-title">Status Breakdown % (Active Bots)</div>
      <canvas id="rateChart"></canvas>
    </div>
  </div>

  <div class="section-title">Active Bots</div>
  <div class="chart-container">
    <div class="chart-title">Status by Bot (counts)</div>
    <canvas id="activeStatusChart"></canvas>
  </div>

  <div class="section-title">Legacy Bots</div>
  <div class="chart-container">
    <div class="chart-title">Status by Bot (counts)</div>
    <canvas id="legacyStatusChart"></canvas>
  </div>

  <div class="section-title">All Outcomes by Bot</div>
  <div class="chart-container">
    <div class="chart-title">Submitted + Rejected + Failed</div>
    <canvas id="pipelineOutcomesChart"></canvas>
  </div>

  <div class="section-title">Notes Per Day</div>
  <div class="chart-container">
    <div class="chart-title">Notes Submitted Per Day (Stacked by Bot)</div>
    <canvas id="dailyNotesChart"></canvas>
  </div>

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
        </tr>
      </thead>
      <tbody id="pipeline-table-body">
      </tbody>
    </table>
  </div>

  <script>
    // Data
    const allNotes = ${JSON.stringify(notesData)};
    const activeBots = ${JSON.stringify(activeBots)};
    const legacyBots = ${JSON.stringify(legacyBots)};
    const colors = ${JSON.stringify(colors)};
    const pipelineByBot = ${JSON.stringify(pipelineData)};
    const pipelineOutcomesData = ${JSON.stringify(pipelineOutcomes)};
    const rawPipelineRuns = ${JSON.stringify(pipelineRuns)};
    const scrapedSummary = ${JSON.stringify(scrapedSummary)};

    // Charts
    let notesChart, rateChart, activeStatusChart, legacyStatusChart, pipelineOutcomesChart, dailyNotesChart;
    const dailyDays = ${JSON.stringify(dailyDays)};
    const dailyDatasets = ${JSON.stringify(dailyDatasets)};

    function formatViews(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
      if (n >= 1000) return Math.round(n / 1000) + "K";
      return n.toString();
    }

    function getStatus(status) {
      const s = status.toUpperCase().replace(/\\s+/g, "_");
      if (s === "CURRENTLY_RATED_HELPFUL" || s === "SHOWN_ON_X") return "helpful";
      if (s === "CURRENTLY_RATED_NOT_HELPFUL" || s === "NOT_SHOWN_ON_X") return "notHelpful";
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
        stats[note.bot_name][getStatus(note.effective_status)]++;
      }
      return stats;
    }

    function filterNotes(timeFilter, mediaFilter, attemptFilter) {
      let notes = allNotes;

      // Time filter
      const now = new Date();
      if (timeFilter === 'week') {
        const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        notes = notes.filter(n => new Date(n.submitted_at) >= cutoff);
      } else if (timeFilter === 'month') {
        const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        notes = notes.filter(n => new Date(n.submitted_at) >= cutoff);
      }

      // Media filter
      if (mediaFilter === 'video') {
        notes = notes.filter(n => n.has_video === true);
      } else if (mediaFilter === 'no-video') {
        notes = notes.filter(n => n.has_video === false);
      }

      // Attempt filter
      if (attemptFilter === 'first') {
        notes = notes.filter(n => !n.is_retry);
      } else if (attemptFilter === 'retry') {
        notes = notes.filter(n => n.is_retry === true);
      }

      return notes;
    }

    function updateCharts() {
      const notes = filterNotes(currentTimeFilter, currentMediaFilter, currentAttemptFilter);
      const activeStats = computeStats(notes, activeBots);
      const legacyStats = computeStats(notes, legacyBots);

      // Compute totals from filtered notes (for helpful rate)
      let totalNotes = 0, totalHelpful = 0, totalNotHelpful = 0, totalNeedsMore = 0;
      for (const bot of [...activeBots, ...legacyBots]) {
        const s = activeStats[bot] || legacyStats[bot];
        if (s) {
          totalNotes += s.total;
          totalHelpful += s.helpful;
          totalNotHelpful += s.notHelpful;
          totalNeedsMore += s.needsMore;
        }
      }
      const knownTotal = totalHelpful + totalNotHelpful + totalNeedsMore;
      const helpfulRate = knownTotal > 0 ? ((totalHelpful / knownTotal) * 100).toFixed(1) : "N/A";

      // Update cards — views and awaiting from scraped table (all non-junk notes), rest from filtered notes
      document.getElementById('total-notes').textContent = totalNotes;
      document.getElementById('helpful-rate').textContent = helpfulRate + '%';
      document.getElementById('total-views').textContent = formatViews(scrapedSummary.totalViews);
      document.getElementById('awaiting-ratings').textContent = scrapedSummary.totalNeedsMore;

      // Sort active bots by total
      const sortedActive = [...activeBots].sort((a, b) => (activeStats[b]?.total || 0) - (activeStats[a]?.total || 0));
      const sortedLegacy = [...legacyBots].sort((a, b) => (legacyStats[b]?.total || 0) - (legacyStats[a]?.total || 0));

      // Notes by Bot (doughnut) - active only
      const activeTotals = sortedActive.map(b => activeStats[b]?.total || 0);
      if (notesChart) notesChart.destroy();
      notesChart = new Chart(document.getElementById('notesChart'), {
        type: 'doughnut',
        data: {
          labels: sortedActive,
          datasets: [{
            data: activeTotals,
            backgroundColor: colors.slice(0, sortedActive.length),
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'right' } }
        }
      });

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
            {
              label: 'Helpful',
              data: sortedActive.map((b, i) => activeKnown[i] > 0 ? ((activeStats[b]?.helpful || 0) / activeKnown[i] * 100).toFixed(1) : 0),
              backgroundColor: 'rgba(34, 197, 94, 0.8)'
            },
            {
              label: 'Not Helpful',
              data: sortedActive.map((b, i) => activeKnown[i] > 0 ? ((activeStats[b]?.notHelpful || 0) / activeKnown[i] * 100).toFixed(1) : 0),
              backgroundColor: 'rgba(239, 68, 68, 0.8)'
            },
            {
              label: 'Needs More',
              data: sortedActive.map((b, i) => activeKnown[i] > 0 ? ((activeStats[b]?.needsMore || 0) / activeKnown[i] * 100).toFixed(1) : 0),
              backgroundColor: 'rgba(245, 158, 11, 0.8)'
            }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom' } },
          scales: {
            x: { stacked: true },
            y: { stacked: true, beginAtZero: true, max: 100, title: { display: true, text: '%' } }
          }
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

      // Pipeline outcomes chart (rejected/failed + submitted note statuses)
      if (pipelineOutcomesChart) pipelineOutcomesChart.destroy();
      const outcomesByBot = {};
      for (const item of pipelineOutcomesData) {
        outcomesByBot[item.bot_id] = item;
      }

      // Combine active and legacy stats with pipeline outcomes
      const allBotsForOutcomes = [...activeBots, ...legacyBots];
      const combinedStats = {};
      for (const bot of allBotsForOutcomes) {
        const noteStats = activeStats[bot] || legacyStats[bot] || { helpful: 0, notHelpful: 0, needsMore: 0 };
        const pipelineOutcomes = outcomesByBot[bot] || { note_not_needed: 0, failed_to_write: 0 };
        combinedStats[bot] = {
          helpful: noteStats.helpful || 0,
          notHelpful: noteStats.notHelpful || 0,
          needsMore: noteStats.needsMore || 0,
          noteNotNeeded: pipelineOutcomes.note_not_needed || 0,
          failedToWrite: pipelineOutcomes.failed_to_write || 0
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

      // Daily notes chart (uses filtered notes)
      if (dailyNotesChart) dailyNotesChart.destroy();
      const filteredByDay = {};
      const filteredBots = new Set();
      for (const note of notes) {
        const day = note.submitted_at.slice(0, 10);
        const bot = note.bot_name || 'unknown';
        filteredBots.add(bot);
        if (!filteredByDay[day]) filteredByDay[day] = {};
        filteredByDay[day][bot] = (filteredByDay[day][bot] || 0) + 1;
      }
      const filteredDays = Object.keys(filteredByDay).sort();
      const botColorMap = {};
      for (const ds of dailyDatasets) botColorMap[ds.label] = ds.backgroundColor;
      const filteredDatasets = [...filteredBots].sort().map(bot => ({
        label: bot,
        data: filteredDays.map(d => filteredByDay[d]?.[bot] || 0),
        backgroundColor: botColorMap[bot] || 'rgba(107, 114, 128, 0.8)',
      }));
      dailyNotesChart = new Chart(document.getElementById('dailyNotesChart'), {
        type: 'bar',
        data: { labels: filteredDays, datasets: filteredDatasets },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom' } },
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Notes' } } }
        }
      });

      // Update pipeline table with same filters
      renderPipelineTable();

      // Update table
      const tbody = document.getElementById('summary-table-body');
      tbody.innerHTML = '';

      // Active bots first
      for (const bot of sortedActive) {
        const s = activeStats[bot];
        if (!s || s.total === 0) continue;
        tbody.innerHTML += \`<tr>
          <td><strong>\${bot}</strong></td>
          <td>\${s.total}</td>
          <td class="helpful">\${s.helpful} <span class="pct">(\${Math.round(s.helpful / s.total * 100)}%)</span></td>
          <td class="not-helpful">\${s.notHelpful} <span class="pct">(\${Math.round(s.notHelpful / s.total * 100)}%)</span></td>
          <td class="needs-more">\${s.needsMore} <span class="pct">(\${Math.round(s.needsMore / s.total * 100)}%)</span></td>
        </tr>\`;
      }

      // Legacy bots
      for (const bot of sortedLegacy) {
        const s = legacyStats[bot];
        if (!s || s.total === 0) continue;
        tbody.innerHTML += \`<tr class="legacy-row">
          <td><strong>\${bot} <span class="legacy">(legacy)</span></strong></td>
          <td>\${s.total}</td>
          <td class="helpful">\${s.helpful} <span class="pct">(\${Math.round(s.helpful / s.total * 100)}%)</span></td>
          <td class="not-helpful">\${s.notHelpful} <span class="pct">(\${Math.round(s.notHelpful / s.total * 100)}%)</span></td>
          <td class="needs-more">\${s.needsMore} <span class="pct">(\${Math.round(s.needsMore / s.total * 100)}%)</span></td>
        </tr>\`;
      }

      // Total row
      tbody.innerHTML += \`<tr style="font-weight: bold; border-top: 2px solid #333;">
        <td>Total</td>
        <td>\${totalNotes}</td>
        <td class="helpful">\${totalHelpful} <span class="pct">(\${knownTotal > 0 ? Math.round(totalHelpful / knownTotal * 100) : 0}%)</span></td>
        <td class="not-helpful">\${totalNotHelpful} <span class="pct">(\${knownTotal > 0 ? Math.round(totalNotHelpful / knownTotal * 100) : 0}%)</span></td>
        <td class="needs-more">\${totalNeedsMore} <span class="pct">(\${knownTotal > 0 ? Math.round(totalNeedsMore / knownTotal * 100) : 0}%)</span></td>
      </tr>\`;
    }

    let currentTimeFilter = 'all';
    let currentMediaFilter = 'all';
    let currentAttemptFilter = 'all';

    function setTimeFilter(filter) {
      currentTimeFilter = filter;
      document.querySelectorAll('#btn-all, #btn-month, #btn-week').forEach(b => b.classList.remove('active'));
      document.getElementById('btn-' + filter).classList.add('active');
      updateCharts();
    }

    function setMediaFilter(filter) {
      currentMediaFilter = filter;
      document.querySelectorAll('#btn-media-all, #btn-media-video, #btn-media-no-video').forEach(b => b.classList.remove('active'));
      document.getElementById('btn-media-' + filter).classList.add('active');
      updateCharts();
    }

    function setAttemptFilter(filter) {
      currentAttemptFilter = filter;
      document.querySelectorAll('#btn-attempt-all, #btn-attempt-first, #btn-attempt-retry').forEach(b => b.classList.remove('active'));
      document.getElementById('btn-attempt-' + filter).classList.add('active');
      updateCharts();
    }

    // Populate pipeline table (respects time filter)
    function renderPipelineTable() {
      const tbody = document.getElementById('pipeline-table-body');
      tbody.innerHTML = '';

      // Filter raw pipeline runs by current time filter
      let runs = rawPipelineRuns;
      const now = new Date();
      if (currentTimeFilter === 'week') {
        const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        runs = runs.filter(r => new Date(r.created_at) >= cutoff);
      } else if (currentTimeFilter === 'month') {
        const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        runs = runs.filter(r => new Date(r.created_at) >= cutoff);
      }

      // Aggregate filtered runs by bot
      const byBot = {};
      for (const r of runs) {
        if (!byBot[r.bot_id]) byBot[r.bot_id] = { total: 0, submitted: 0, filtered: 0, failed: 0, rejected: 0 };
        byBot[r.bot_id].total++;
        if (r.outcome in byBot[r.bot_id]) byBot[r.bot_id][r.outcome]++;
      }

      const allBotIds = [...activeBots, ...legacyBots];
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
      </tr>\`;
    }
    renderPipelineTable();

    // Initial render
    updateCharts();
  </script>
</body>
</html>`;

writeFileSync("tmp/reports/full-bot-report.html", html);
console.log("Report generated: tmp/reports/full-bot-report.html");
