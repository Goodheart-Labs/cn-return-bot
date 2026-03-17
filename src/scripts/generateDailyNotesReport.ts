import "dotenv/config";
import { SupabaseLogger } from "../api/supabaseClient";
import { writeFileSync } from "fs";

const supabase = new SupabaseLogger();
const notes = await supabase.getNotesWithLatestSnapshots();

// Group by day and bot
const byDayBot: Record<string, Record<string, number>> = {};
const allBots = new Set<string>();

for (const note of notes) {
  const day = note.submitted_at.slice(0, 10);
  const bot = note.bot_name || "unknown";
  allBots.add(bot);
  if (!byDayBot[day]) byDayBot[day] = {};
  byDayBot[day][bot] = (byDayBot[day][bot] || 0) + 1;
}

const days = Object.keys(byDayBot).sort();
const bots = [...allBots].sort();

const botColors: Record<string, string> = {
  "opus-main": "rgba(59, 130, 246, 0.8)",
  "opus-concise": "rgba(34, 197, 94, 0.8)",
  "gemini-flash": "rgba(245, 158, 11, 0.8)",
  "opus-scored": "rgba(168, 85, 247, 0.8)",
  "multi-search": "rgba(20, 184, 166, 0.8)",
  "gemini-3-flash": "rgba(236, 72, 153, 0.8)",
  deepseek: "rgba(239, 68, 68, 0.8)",
  unknown: "rgba(156, 163, 175, 0.8)",
};

const datasets = bots.map((bot) => ({
  label: bot,
  data: days.map((d) => byDayBot[d]?.[bot] || 0),
  backgroundColor: botColors[bot] || "rgba(107, 114, 128, 0.8)",
}));

const totalByDay = days.map((d) => Object.values(byDayBot[d] || {}).reduce((a, b) => a + b, 0));
const avg = (totalByDay.reduce((a, b) => a + b, 0) / totalByDay.length).toFixed(1);

const html = `<!DOCTYPE html>
<html>
<head>
  <title>Notes Per Day</title>
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
    .subtitle { color: #666; margin-bottom: 30px; }
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
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
    .card-value { font-size: 1.8em; font-weight: bold; margin: 5px 0; color: #3b82f6; }
    .chart-container {
      background: white;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-bottom: 20px;
    }
    .chart-title { font-weight: 600; color: #333; margin-bottom: 15px; }
    canvas { max-height: 350px; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { font-weight: 600; color: #333; }
    td { color: #666; font-variant-numeric: tabular-nums; }
    .total { font-weight: bold; }
    .generated { color: #666; margin-top: 20px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Notes Written Per Day</h1>
  <p class="subtitle">Daily submission counts by bot</p>

  <div class="summary-cards">
    <div class="card">
      <div class="card-label">Total Notes</div>
      <div class="card-value">${notes.length}</div>
    </div>
<div class="card">
      <div class="card-label">Avg / Day</div>
      <div class="card-value">${avg}</div>
    </div>
  </div>

  <div class="chart-container">
    <div class="chart-title">Notes Submitted Per Day (Stacked by Bot)</div>
    <canvas id="dailyChart"></canvas>
  </div>

  <div class="chart-container">
    <div class="chart-title">Daily Breakdown</div>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          ${bots.map((b) => `<th>${b}</th>`).join("\n          ")}
          <th class="total">Total</th>
        </tr>
      </thead>
      <tbody>
        ${days
          .map((d) => {
            const total = Object.values(byDayBot[d] || {}).reduce((a: number, b: number) => a + b, 0);
            return `<tr>
          <td>${d}</td>
          ${bots.map((b) => `<td>${byDayBot[d]?.[b] || 0}</td>`).join("\n          ")}
          <td class="total">${total}</td>
        </tr>`;
          })
          .join("\n        ")}
      </tbody>
    </table>
    <p class="generated">Generated: ${new Date().toISOString().split("T")[0]}</p>
  </div>

  <script>
    new Chart(document.getElementById('dailyChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(days)},
        datasets: ${JSON.stringify(datasets)}
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Notes' } }
        }
      }
    });
  </script>
</body>
</html>`;

writeFileSync("docs/notes-per-day.html", html);
console.log("Report generated: docs/notes-per-day.html");
