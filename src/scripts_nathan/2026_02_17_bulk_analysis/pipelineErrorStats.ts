/**
 * Generate HTML report showing pipeline error statistics
 */

import { getSupabaseClient } from "../../api/supabaseClient";
import * as fs from "fs";

const supabase = getSupabaseClient();

async function main() {
  // Get all pipeline runs with outcome counts
  const { data: outcomeCounts, error: outcomeError } = await supabase
    .from("pipeline_runs")
    .select("outcome")
    .order("created_at", { ascending: false });

  if (outcomeError) {
    console.error("Error fetching outcomes:", outcomeError);
    return;
  }

  // Count by outcome
  const counts: Record<string, number> = {};
  for (const row of outcomeCounts || []) {
    counts[row.outcome] = (counts[row.outcome] || 0) + 1;
  }

  const total = outcomeCounts?.length || 0;
  const failed = counts["failed"] || 0;
  const submitted = counts["submitted"] || 0;
  const filtered = counts["filtered"] || 0;
  const rejected = counts["rejected"] || 0;

  // Get recent errors with details
  const { data: recentErrors } = await supabase
    .from("pipeline_runs")
    .select("tweet_id, bot_id, error_message, final_stage, created_at")
    .eq("outcome", "failed")
    .order("created_at", { ascending: false })
    .limit(50);

  // Get errors by bot
  const { data: errorsByBot } = await supabase
    .from("pipeline_runs")
    .select("bot_id")
    .eq("outcome", "failed");

  const botErrorCounts: Record<string, number> = {};
  for (const row of errorsByBot || []) {
    const bot = row.bot_id || "unknown";
    botErrorCounts[bot] = (botErrorCounts[bot] || 0) + 1;
  }

  // Get errors by stage
  const { data: errorsByStage } = await supabase
    .from("pipeline_runs")
    .select("final_stage")
    .eq("outcome", "failed");

  const stageErrorCounts: Record<string, number> = {};
  for (const row of errorsByStage || []) {
    const stage = row.final_stage || "unknown";
    stageErrorCounts[stage] = (stageErrorCounts[stage] || 0) + 1;
  }

  // Generate HTML
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Pipeline Error Statistics</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .stat-card h3 { margin: 0 0 10px 0; color: #666; font-size: 14px; text-transform: uppercase; }
    .stat-card .value { font-size: 36px; font-weight: bold; }
    .stat-card .percent { color: #666; font-size: 14px; }
    .stat-card.error .value { color: #e74c3c; }
    .stat-card.success .value { color: #27ae60; }
    .stat-card.filtered .value { color: #f39c12; }
    .breakdown { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
    .breakdown h2 { margin-top: 0; }
    .breakdown table { width: 100%; border-collapse: collapse; }
    .breakdown th, .breakdown td { padding: 10px; text-align: left; border-bottom: 1px solid #eee; }
    .breakdown th { background: #f9f9f9; }
    .error-list { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .error-item { padding: 15px; border-bottom: 1px solid #eee; }
    .error-item:last-child { border-bottom: none; }
    .error-item .meta { color: #666; font-size: 12px; margin-bottom: 5px; }
    .error-item .message { font-family: monospace; font-size: 13px; background: #f9f9f9; padding: 10px; border-radius: 4px; white-space: pre-wrap; word-break: break-all; }
    .bar { height: 20px; background: #e0e0e0; border-radius: 4px; overflow: hidden; margin-top: 5px; }
    .bar-fill { height: 100%; }
    .bar-fill.error { background: #e74c3c; }
    .bar-fill.success { background: #27ae60; }
    .bar-fill.filtered { background: #f39c12; }
    .bar-fill.rejected { background: #9b59b6; }
  </style>
</head>
<body>
  <h1>Pipeline Error Statistics</h1>
  <p>Generated: ${new Date().toISOString()}</p>

  <div class="stats-grid">
    <div class="stat-card">
      <h3>Total Runs</h3>
      <div class="value">${total.toLocaleString()}</div>
    </div>
    <div class="stat-card error">
      <h3>Failed</h3>
      <div class="value">${failed.toLocaleString()}</div>
      <div class="percent">${((failed / total) * 100).toFixed(2)}%</div>
    </div>
    <div class="stat-card success">
      <h3>Submitted</h3>
      <div class="value">${submitted.toLocaleString()}</div>
      <div class="percent">${((submitted / total) * 100).toFixed(2)}%</div>
    </div>
    <div class="stat-card filtered">
      <h3>Filtered</h3>
      <div class="value">${filtered.toLocaleString()}</div>
      <div class="percent">${((filtered / total) * 100).toFixed(2)}%</div>
    </div>
  </div>

  <div class="breakdown">
    <h2>Outcome Distribution</h2>
    <div class="bar">
      <div class="bar-fill success" style="width: ${(submitted / total) * 100}%; display: inline-block;"></div><div class="bar-fill filtered" style="width: ${(filtered / total) * 100}%; display: inline-block;"></div><div class="bar-fill error" style="width: ${(failed / total) * 100}%; display: inline-block;"></div><div class="bar-fill rejected" style="width: ${(rejected / total) * 100}%; display: inline-block;"></div>
    </div>
    <p style="font-size: 12px; color: #666;">
      <span style="color: #27ae60;">■</span> Submitted (${((submitted / total) * 100).toFixed(1)}%)
      <span style="color: #f39c12; margin-left: 15px;">■</span> Filtered (${((filtered / total) * 100).toFixed(1)}%)
      <span style="color: #e74c3c; margin-left: 15px;">■</span> Failed (${((failed / total) * 100).toFixed(1)}%)
      <span style="color: #9b59b6; margin-left: 15px;">■</span> Rejected (${((rejected / total) * 100).toFixed(1)}%)
    </p>
  </div>

  <div class="breakdown">
    <h2>Errors by Bot</h2>
    <table>
      <tr><th>Bot</th><th>Error Count</th><th>% of Errors</th></tr>
      ${Object.entries(botErrorCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([bot, count]) => `<tr><td>${bot}</td><td>${count}</td><td>${((count / failed) * 100).toFixed(1)}%</td></tr>`)
        .join("\n      ")}
    </table>
  </div>

  <div class="breakdown">
    <h2>Errors by Stage</h2>
    <table>
      <tr><th>Stage</th><th>Error Count</th><th>% of Errors</th></tr>
      ${Object.entries(stageErrorCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([stage, count]) => `<tr><td>${stage}</td><td>${count}</td><td>${((count / failed) * 100).toFixed(1)}%</td></tr>`)
        .join("\n      ")}
    </table>
  </div>

  <div class="error-list">
    <h2>Recent Errors (Last 50)</h2>
    ${(recentErrors || [])
      .map(
        (e) => `
    <div class="error-item">
      <div class="meta">
        <strong>${e.bot_id || "unknown"}</strong> |
        Stage: ${e.final_stage || "unknown"} |
        Tweet: ${e.tweet_id} |
        ${new Date(e.created_at).toLocaleString()}
      </div>
      <div class="message">${e.error_message || "No error message"}</div>
    </div>`
      )
      .join("")}
  </div>
</body>
</html>`;

  const outputPath = "/tmp/pipeline-error-stats.html";
  fs.writeFileSync(outputPath, html);
  console.log(`Report written to ${outputPath}`);

  // Also print summary
  console.log("\n=== Summary ===");
  console.log(`Total runs: ${total}`);
  console.log(`Failed: ${failed} (${((failed / total) * 100).toFixed(2)}%)`);
  console.log(`Submitted: ${submitted} (${((submitted / total) * 100).toFixed(2)}%)`);
  console.log(`Filtered: ${filtered} (${((filtered / total) * 100).toFixed(2)}%)`);
}

main();
