import "dotenv/config";
import { SupabaseLogger } from "../api/supabaseClient";
import { writeFileSync } from "fs";

const supabase = new SupabaseLogger();
const notes = await supabase.getNotesWithLatestSnapshots();

// Group by bot
const botStats: Record<
  string,
  {
    total: number;
    helpful: number;
    needsMore: number;
    notHelpful: number;
    unknown: number;
    totalViews: number;
    statusSources: { public_data: number; snapshot: number; unknown: number };
  }
> = {};

for (const note of notes) {
  const bot = note.bot_name || "unknown";
  if (!botStats[bot]) {
    botStats[bot] = {
      total: 0,
      helpful: 0,
      needsMore: 0,
      notHelpful: 0,
      unknown: 0,
      totalViews: 0,
      statusSources: { public_data: 0, snapshot: 0, unknown: 0 },
    };
  }

  botStats[bot].total++;
  botStats[bot].totalViews += note.view_count;
  botStats[bot].statusSources[note.status_source]++;

  const statusLower = note.effective_status.toLowerCase().replace(/_/g, " ");
  if (statusLower.includes("helpful") && !statusLower.includes("not")) {
    botStats[bot].helpful++;
  } else if (statusLower.includes("not helpful")) {
    botStats[bot].notHelpful++;
  } else if (statusLower.includes("needs more")) {
    botStats[bot].needsMore++;
  } else {
    botStats[bot].unknown++;
  }
}

// Calculate totals
const grandTotal = {
  notes: 0,
  helpful: 0,
  needsMore: 0,
  notHelpful: 0,
  views: 0,
  sources: { public_data: 0, snapshot: 0, unknown: 0 },
};

const sortedBots = Object.entries(botStats).sort((a, b) => b[1].total - a[1].total);

for (const [, stats] of sortedBots) {
  grandTotal.notes += stats.total;
  grandTotal.helpful += stats.helpful;
  grandTotal.needsMore += stats.needsMore;
  grandTotal.notHelpful += stats.notHelpful;
  grandTotal.views += stats.totalViews;
  grandTotal.sources.public_data += stats.statusSources.public_data;
  grandTotal.sources.snapshot += stats.statusSources.snapshot;
  grandTotal.sources.unknown += stats.statusSources.unknown;
}

// Helpful rate = helpful / (helpful + notHelpful + needsMore) - excludes unknown/pending
const knownTotal = grandTotal.helpful + grandTotal.notHelpful + grandTotal.needsMore;
const overallRate =
  knownTotal > 0
    ? ((grandTotal.helpful / knownTotal) * 100).toFixed(1)
    : "N/A";

// Generate HTML
const botNames = sortedBots.map(([name]) => name);
const colors = [
  "rgba(59, 130, 246, 0.8)",
  "rgba(239, 68, 68, 0.8)",
  "rgba(34, 197, 94, 0.8)",
  "rgba(168, 85, 247, 0.8)",
  "rgba(245, 158, 11, 0.8)",
  "rgba(107, 114, 128, 0.8)",
  "rgba(20, 184, 166, 0.8)",
  "rgba(236, 72, 153, 0.8)",
];

function formatViews(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(0) + "K";
  return n.toString();
}

function getHelpfulRateClass(helpful: number, notHelpful: number): string {
  if (helpful + notHelpful === 0) return "rate-na";
  const rate = (helpful / (helpful + notHelpful)) * 100;
  if (rate >= 80) return "rate-good";
  if (rate >= 50) return "rate-mid";
  return "rate-bad";
}

function getHelpfulRate(helpful: number, notHelpful: number): string {
  if (helpful + notHelpful === 0) return "N/A";
  return ((helpful / (helpful + notHelpful)) * 100).toFixed(1) + "%";
}

const tableRows = sortedBots
  .map(([bot, stats]) => {
    const total = stats.total;
    const helpfulPct = (stats.helpful / total) * 100;
    const notHelpfulPct = (stats.notHelpful / total) * 100;
    const needsMorePct = (stats.needsMore / total) * 100;
    const unknownPct = (stats.unknown / total) * 100;

    return `      <tr>
        <td class="bot-name">${bot}</td>
        <td>${stats.total}</td>
        <td>${stats.helpful}</td>
        <td>${stats.notHelpful}</td>
        <td>${stats.needsMore}</td>
        <td class="${getHelpfulRateClass(stats.helpful, stats.notHelpful)}">${getHelpfulRate(stats.helpful, stats.notHelpful)}</td>
        <td class="views">${stats.totalViews.toLocaleString()}</td>
        <td>
          <div class="bar" style="width: 200px;">
            <div class="bar-helpful" style="width: ${helpfulPct}%"></div>
            <div class="bar-not-helpful" style="width: ${notHelpfulPct}%"></div>
            <div class="bar-needs-more" style="width: ${needsMorePct}%"></div>
            <div class="bar-unknown" style="width: ${unknownPct}%"></div>
          </div>
        </td>
      </tr>`;
  })
  .join("\n");

const html = `<!DOCTYPE html>
<html>
<head>
  <title>Bot Performance Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    h1 { color: #1a1a1a; margin-bottom: 5px; }
    .subtitle { color: #666; margin-bottom: 30px; }
    .summary-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px; }
    .card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .card-label { color: #666; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.5px; }
    .card-value { font-size: 2.2em; font-weight: 700; margin: 5px 0; }
    .card-value.green { color: #22c55e; }
    .card-value.blue { color: #3b82f6; }
    .card-value.yellow { color: #f59e0b; }
    .card-value.purple { color: #8b5cf6; }
    .chart-container { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 20px; }
    .chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    .chart-title { font-weight: 600; color: #333; margin-bottom: 15px; }
    canvas { max-height: 300px; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    th, td { padding: 14px 16px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8f9fa; font-weight: 600; color: #555; font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.5px; }
    tr:hover { background: #fafafa; }
    tr:last-child td { border-bottom: none; }
    .rate-good { color: #22c55e; font-weight: 600; }
    .rate-bad { color: #ef4444; font-weight: 600; }
    .rate-mid { color: #f59e0b; font-weight: 600; }
    .rate-na { color: #9ca3af; }
    .bot-name { font-weight: 600; color: #1a1a1a; }
    .views { color: #666; }
    .bar { height: 8px; border-radius: 4px; display: flex; overflow: hidden; background: #e5e7eb; }
    .bar-helpful { background: #22c55e; }
    .bar-not-helpful { background: #ef4444; }
    .bar-needs-more { background: #f59e0b; }
    .bar-unknown { background: #d1d5db; }
    .status-sources { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-top: 20px; }
    .status-sources h3 { margin-top: 0; color: #333; }
    .source-bar { display: flex; height: 24px; border-radius: 6px; overflow: hidden; margin-top: 10px; }
    .source-public { background: #3b82f6; }
    .source-snapshot { background: #8b5cf6; }
    .source-unknown { background: #d1d5db; }
    .source-legend { display: flex; gap: 20px; margin-top: 10px; font-size: 0.9em; color: #666; }
    .source-legend span { display: flex; align-items: center; gap: 5px; }
    .source-legend .dot { width: 12px; height: 12px; border-radius: 3px; }
    footer { text-align: center; color: #999; margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; }
  </style>
</head>
<body>
  <h1>Bot Performance Report</h1>
  <p class="subtitle">Community Notes submission tracking across all bots</p>

  <div class="summary-cards">
    <div class="card">
      <div class="card-label">Total Notes</div>
      <div class="card-value blue">${grandTotal.notes}</div>
    </div>
    <div class="card">
      <div class="card-label">Helpful Rate</div>
      <div class="card-value green">${overallRate}%</div>
    </div>
    <div class="card">
      <div class="card-label">Total Views</div>
      <div class="card-value purple" style="font-size: 1.2em;">Not yet built</div>
    </div>
    <div class="card">
      <div class="card-label">Awaiting Ratings</div>
      <div class="card-value yellow">${grandTotal.needsMore}</div>
    </div>
  </div>

  <div class="chart-row">
    <div class="chart-container">
      <div class="chart-title">Note Weighting by Bot</div>
      <canvas id="notesChart"></canvas>
    </div>
    <div class="chart-container">
      <div class="chart-title">Status Breakdown by Bot (%)</div>
      <canvas id="rateChart"></canvas>
    </div>
  </div>

  <div class="chart-container">
    <div class="chart-title">Status Breakdown by Bot</div>
    <canvas id="statusChart"></canvas>
  </div>

  <footer>Generated: ${new Date().toISOString().split("T")[0]}</footer>

  <script>
    const botNames = ${JSON.stringify(botNames)};
    const colors = ${JSON.stringify(colors)};
    const totals = ${JSON.stringify(sortedBots.map(([, s]) => s.total))};
    const helpful = ${JSON.stringify(sortedBots.map(([, s]) => s.helpful))};
    const notHelpful = ${JSON.stringify(sortedBots.map(([, s]) => s.notHelpful))};
    const needsMore = ${JSON.stringify(sortedBots.map(([, s]) => s.needsMore))};
    const unknown = ${JSON.stringify(sortedBots.map(([, s]) => s.unknown))};

    // Total notes with known status (helpful + not helpful + needs more)
    const totalWithStatus = ${grandTotal.helpful + grandTotal.notHelpful + grandTotal.needsMore};

    // Notes by Bot
    new Chart(document.getElementById('notesChart'), {
      type: 'doughnut',
      data: {
        labels: botNames,
        datasets: [{
          data: totals,
          backgroundColor: colors,
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'right' }
        }
      }
    });

    // Per-bot status breakdown (each bot's bars add up to 100%, excluding unknown)
    // Denominator = helpful + notHelpful + needsMore (known statuses only)
    const knownTotals = botNames.map((_, i) => helpful[i] + notHelpful[i] + needsMore[i]);

    new Chart(document.getElementById('rateChart'), {
      type: 'bar',
      data: {
        labels: botNames,
        datasets: [
          {
            label: 'Helpful',
            data: helpful.map((h, i) => knownTotals[i] > 0 ? (h / knownTotals[i] * 100).toFixed(1) : 0),
            backgroundColor: 'rgba(34, 197, 94, 0.8)'
          },
          {
            label: 'Not Helpful',
            data: notHelpful.map((n, i) => knownTotals[i] > 0 ? (n / knownTotals[i] * 100).toFixed(1) : 0),
            backgroundColor: 'rgba(239, 68, 68, 0.8)'
          },
          {
            label: 'Needs More Ratings',
            data: needsMore.map((n, i) => knownTotals[i] > 0 ? (n / knownTotals[i] * 100).toFixed(1) : 0),
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

    // Status Breakdown
    new Chart(document.getElementById('statusChart'), {
      type: 'bar',
      data: {
        labels: botNames,
        datasets: [
          {
            label: 'Helpful',
            data: helpful,
            backgroundColor: 'rgba(34, 197, 94, 0.8)'
          },
          {
            label: 'Not Helpful',
            data: notHelpful,
            backgroundColor: 'rgba(239, 68, 68, 0.8)'
          },
          {
            label: 'Needs More Ratings',
            data: needsMore,
            backgroundColor: 'rgba(245, 158, 11, 0.8)'
          },
          {
            label: 'Unknown/Pending',
            data: unknown,
            backgroundColor: 'rgba(209, 213, 219, 0.8)'
          }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true }
        }
      }
    });
  </script>
</body>
</html>`;

writeFileSync("docs/full-bot-report.html", html);
console.log("Report generated: docs/full-bot-report.html");
