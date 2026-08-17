/**
 * Per-bot breakdown. It answers the question "what is each bot actually doing?".
 *
 * For every bot it prints how many notes the bot submitted, how Community Notes
 * rated them, how many views they reached, how often the pipeline wrote a note
 * instead of rejecting one, and what all of that cost.
 *
 * A note row does not say which bot wrote it. The bot name lives on
 * pipeline_runs, so we map runs onto notes by note_id. This is the same mapping
 * src/reports/generateMainReport.ts uses.
 *
 * Run from repo root:
 *   bun run src/scripts/botBreakdown.ts            # prod Supabase
 *   bun run src/scripts/botBreakdown.ts --local    # LOCAL_SUPABASE_*
 *   bun run src/scripts/botBreakdown.ts --active    # active bots only
 */
import "dotenv/config";

const useLocal = process.argv.includes("--local");
if (useLocal) {
  const localUrl = process.env.LOCAL_SUPABASE_URL;
  const localKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
  if (!localUrl || !localKey) {
    console.error("[botBreakdown] --local requires LOCAL_SUPABASE_URL and LOCAL_SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  process.env.SUPABASE_URL = localUrl;
  process.env.SUPABASE_SERVICE_KEY = localKey;
}
const activeOnly = process.argv.includes("--active");

import { getSupabaseClient } from "../api/supabaseClient";
import { fetchAllRows } from "../api/paging";

const client = getSupabaseClient();

// This list has to stay in sync with the activeBots array in
// src/reports/generateMainReport.ts.
const ACTIVE_BOTS = new Set(["multi-agent", "simple-bot", "agent", "cheap-bot"]);

console.log(`[botBreakdown] Fetching from ${useLocal ? "LOCAL" : "PROD"} Supabase...`);

const notes = await fetchAllRows<{
  note_id: string;
  cn_status: string | null;
  view_count: number | null;
  rating_count: number | null;
  helpful_count: number | null;
  not_helpful_count: number | null;
  submitted_at: string | null;
}>(
  () => client.from("notes")
    .select("note_id, cn_status, view_count, rating_count, helpful_count, not_helpful_count, submitted_at")
    .not("submitted_at", "is", null),
  "note_id",
  { label: "botBreakdown.notes" },
);

const runs = await fetchAllRows<{
  id: string;
  note_id: string | null;
  bot_name: string | null;
  outcome: string | null;
  cost: number | null;
}>(
  () => client.from("pipeline_runs").select("id, note_id, bot_name, outcome, cost"),
  "id",
  { label: "botBreakdown.runs" },
);

// Work out which bot owns each note. A note can have several submitted runs.
// We keep the last one we come across, which is what the main report does too.
const botByNoteId = new Map<string, string>();
for (const r of runs) {
  if (r.outcome === "submitted" && r.note_id && r.bot_name) {
    botByNoteId.set(r.note_id, r.bot_name);
  }
}

interface BotStat {
  bot: string;
  notes: number;
  helpful: number;      // Notes whose current status is CURRENTLY_RATED_HELPFUL.
  notHelpful: number;   // Notes whose current status is CURRENTLY_RATED_NOT_HELPFUL.
  needsMore: number;    // Notes whose current status is NEEDS_MORE_RATINGS.
  otherStatus: number;
  views: number;
  helpfulVotes: number;
  notHelpfulVotes: number;
  firstAt: string | null;
  lastAt: string | null;
  submitted: number;    // Counted over every run, not only runs that made a note.
  rejected: number;
  failed: number;
  cost: number;
}

const stats = new Map<string, BotStat>();
function stat(bot: string): BotStat {
  let s = stats.get(bot);
  if (!s) {
    s = {
      bot, notes: 0, helpful: 0, notHelpful: 0, needsMore: 0, otherStatus: 0,
      views: 0, helpfulVotes: 0, notHelpfulVotes: 0, firstAt: null, lastAt: null,
      submitted: 0, rejected: 0, failed: 0, cost: 0,
    };
    stats.set(bot, s);
  }
  return s;
}

// Note-level metrics, keyed by the bot that owns the note.
for (const n of notes) {
  const bot = botByNoteId.get(n.note_id) ?? "pre-tracking";
  const s = stat(bot);
  s.notes++;
  s.views += n.view_count ?? 0;
  s.helpfulVotes += n.helpful_count ?? 0;
  s.notHelpfulVotes += n.not_helpful_count ?? 0;
  switch (n.cn_status) {
    case "CURRENTLY_RATED_HELPFUL": s.helpful++; break;
    case "CURRENTLY_RATED_NOT_HELPFUL": s.notHelpful++; break;
    case "NEEDS_MORE_RATINGS": s.needsMore++; break;
    default: s.otherStatus++;
  }
  if (n.submitted_at) {
    if (!s.firstAt || n.submitted_at < s.firstAt) s.firstAt = n.submitted_at;
    if (!s.lastAt || n.submitted_at > s.lastAt) s.lastAt = n.submitted_at;
  }
}

// Count the outcomes and the cost of each run against the bot named on the run
// itself, which is not always the bot that owns the resulting note.
for (const r of runs) {
  const bot = r.bot_name ?? "unknown";
  const s = stat(bot);
  if (r.outcome === "submitted") s.submitted++;
  else if (r.outcome === "rejected") s.rejected++;
  else if (r.outcome === "failed") s.failed++;
  s.cost += Number(r.cost ?? 0);
}

let rows = [...stats.values()].filter((s) => s.notes > 0 || s.submitted > 0 || s.cost > 0);
if (activeOnly) rows = rows.filter((s) => ACTIVE_BOTS.has(s.bot));
rows.sort((a, b) => b.notes - a.notes);

const pct = (num: number, den: number) => (den === 0 ? "  -  " : `${((100 * num) / den).toFixed(1)}%`);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "  -  ");
const num = (n: number) => n.toLocaleString("en-US");

console.log("\nPER-BOT BREAKDOWN" + (activeOnly ? " (active only)" : "") + "\n");
for (const s of rows) {
  const writeRate = pct(s.submitted, s.submitted + s.rejected + s.failed);
  const helpfulRate = pct(s.helpful, s.notes);
  const tag = ACTIVE_BOTS.has(s.bot) ? "●" : "○";
  const avgViews = s.notes ? Math.round(s.views / s.notes) : 0;
  console.log(`${tag} ${s.bot}`);
  console.log(`    notes submitted : ${num(s.notes)}   (${day(s.firstAt)} → ${day(s.lastAt)})`);
  console.log(`    CN status       : helpful ${num(s.helpful)} (${helpfulRate}) · needs-more ${num(s.needsMore)} · not-helpful ${num(s.notHelpful)} · other ${num(s.otherStatus)}`);
  console.log(`    reach           : ${num(s.views)} views   (avg ${num(avgViews)}/note)`);
  console.log(`    public votes    : 👍 ${num(s.helpfulVotes)} · 👎 ${num(s.notHelpfulVotes)}`);
  console.log(`    pipeline runs   : ${num(s.submitted)} submitted · ${num(s.rejected)} rejected · ${num(s.failed)} failed   (write rate ${writeRate})`);
  console.log(`    cost            : $${s.cost.toFixed(2)}   (avg $${s.notes ? (s.cost / s.notes).toFixed(3) : "0"}/note)`);
  console.log("");
}

const legend = `● = active bot   ○ = legacy/other`;
console.log(legend);
console.log(`\nTotals: ${num(rows.reduce((a, s) => a + s.notes, 0))} notes across ${rows.length} bots · $${rows.reduce((a, s) => a + s.cost, 0).toFixed(2)} spend\n`);

// The --html flag writes a chart page to a temporary file and opens it. The
// page pulls Chart.js from a CDN, so it needs an internet connection to render.
if (process.argv.includes("--html")) {
  const { writeFileSync } = await import("fs");
  const { execSync } = await import("child_process");
  const { tmpdir } = await import("os");
  const { join } = await import("path");

  const labels = rows.map((s) => s.bot);
  const data = {
    labels,
    notes: rows.map((s) => s.notes),
    helpfulRate: rows.map((s) => (s.notes ? (100 * s.helpful) / s.notes : 0)),
    avgViews: rows.map((s) => (s.notes ? Math.round(s.views / s.notes) : 0)),
    costPerNote: rows.map((s) => (s.notes ? s.cost / s.notes : 0)),
    active: rows.map((s) => ACTIVE_BOTS.has(s.bot)),
  };
  const colorFor = (active: boolean) => (active ? "rgba(37,99,235,0.85)" : "rgba(148,163,184,0.75)");
  const colors = data.active.map(colorFor);

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Bot breakdown</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  body{font:14px system-ui,sans-serif;margin:24px;background:#f8fafc;color:#0f172a}
  h1{font-size:20px} .meta{color:#64748b;margin-bottom:20px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;max-width:1100px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px}
  .card h2{font-size:14px;margin:0 0 10px;color:#334155}
  @media(max-width:760px){.grid{grid-template-columns:1fr}}
</style></head><body>
<h1>Per-bot breakdown</h1>
<div class="meta">Blue = active · grey = legacy · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</div>
<div class="grid">
  <div class="card"><h2>Notes submitted</h2><canvas id="c1"></canvas></div>
  <div class="card"><h2>Helpful rate (% of notes CURRENTLY_RATED_HELPFUL)</h2><canvas id="c2"></canvas></div>
  <div class="card"><h2>Avg views / note</h2><canvas id="c3"></canvas></div>
  <div class="card"><h2>Cost / note ($)</h2><canvas id="c4"></canvas></div>
</div>
<script>
const D=${JSON.stringify(data)};const C=${JSON.stringify(colors)};
const opt=(fmt)=>({indexAxis:'y',responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:(x)=>fmt(x.raw)}}},scales:{x:{beginAtZero:true}}});
const bar=(id,arr,fmt)=>new Chart(document.getElementById(id),{type:'bar',data:{labels:D.labels,datasets:[{data:arr,backgroundColor:C}]},options:opt(fmt)});
bar('c1',D.notes,(v)=>v.toLocaleString());
bar('c2',D.helpfulRate,(v)=>v.toFixed(1)+'%');
bar('c3',D.avgViews,(v)=>Math.round(v).toLocaleString());
bar('c4',D.costPerNote,(v)=>'$'+v.toFixed(3));
</script></body></html>`;

  const out = join(tmpdir(), "bot-breakdown.html");
  writeFileSync(out, html);
  console.log(`[botBreakdown] Wrote chart page → ${out}`);
  try { execSync(`open "${out}"`); } catch { /* The open command only exists on macOS. */ }
}

// The --daily flag writes a second chart with one stacked bar per day. Helpful
// notes grow upwards in green and unhelpful notes grow downwards in red. Each
// bot gets its own shade of both colours. The chart covers the last N days,
// which --days sets and which defaults to 30.
if (process.argv.includes("--daily")) {
  const { writeFileSync } = await import("fs");
  const { execSync } = await import("child_process");
  const { tmpdir } = await import("os");
  const { join } = await import("path");

  const daysArgIdx = process.argv.indexOf("--days");
  const windowDays = daysArgIdx >= 0 ? Number(process.argv[daysArgIdx + 1]) || 30 : 30;

  // Build the day axis from oldest to newest. Today is part of it.
  const today = new Date();
  const dayKeys: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }
  const earliest = dayKeys[0]!;

  // Count helpful and unhelpful notes for each bot on each day. The count uses
  // the status a note carries right now, plotted on the day it was submitted.
  const perBot = new Map<string, { helpful: Map<string, number>; unhelpful: Map<string, number>; total: number }>();
  for (const n of notes) {
    if (!n.submitted_at) continue;
    const day = n.submitted_at.slice(0, 10);
    if (day < earliest) continue;
    if (n.cn_status !== "CURRENTLY_RATED_HELPFUL" && n.cn_status !== "CURRENTLY_RATED_NOT_HELPFUL") continue;
    const bot = botByNoteId.get(n.note_id) ?? "pre-tracking";
    let b = perBot.get(bot);
    if (!b) { b = { helpful: new Map(), unhelpful: new Map(), total: 0 }; perBot.set(bot, b); }
    const bucket = n.cn_status === "CURRENTLY_RATED_HELPFUL" ? b.helpful : b.unhelpful;
    bucket.set(day, (bucket.get(day) ?? 0) + 1);
    b.total++;
  }

  // Sort the bots with the most notes first, so the darkest shade always goes
  // to the bot with the highest volume.
  const bots = [...perBot.entries()].filter(([, b]) => b.total > 0).sort((a, b) => b[1].total - a[1].total).map(([name]) => name);
  if (bots.length === 0) {
    console.log(`[botBreakdown] No helpful/unhelpful notes in the last ${windowDays} days — nothing to chart.`);
  } else {
    // Give each bot one lightness value. It is used for the bot's green bar
    // above the line and for its red bar below it.
    const shade = (i: number) => 32 + (bots.length === 1 ? 8 : (i / (bots.length - 1)) * 38); // 32%..70%
    const datasets: any[] = [];
    bots.forEach((bot, i) => {
      const L = shade(i);
      const b = perBot.get(bot)!;
      datasets.push({
        label: bot, stack: "notes",
        backgroundColor: `hsl(142, 50%, ${L}%)`,
        data: dayKeys.map((d) => b.helpful.get(d) ?? 0),
      });
      datasets.push({
        label: `${bot} (unhelpful)`, stack: "notes", isUnhelpful: true,
        backgroundColor: `hsl(2, 62%, ${L}%)`,
        data: dayKeys.map((d) => -(b.unhelpful.get(d) ?? 0)),
      });
    });

    const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Notes by bot by day</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  body{font:14px system-ui,sans-serif;margin:24px;background:#f8fafc;color:#0f172a}
  h1{font-size:20px;margin-bottom:2px} .meta{color:#64748b;margin-bottom:18px}
  .wrap{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:18px;max-width:1200px}
</style></head><body>
<h1>Notes by bot, by day — helpful ↑ (green) · unhelpful ↓ (red)</h1>
<div class="meta">Last ${windowDays} days · stacked by bot (darker shade = higher-volume bot) · status = current CN rating, plotted on submission day</div>
<div class="wrap"><canvas id="c" height="120"></canvas></div>
<script>
const LABELS=${JSON.stringify(dayKeys)};const DS=${JSON.stringify(datasets)};
new Chart(document.getElementById('c'),{
  type:'bar',
  data:{labels:LABELS,datasets:DS},
  options:{
    responsive:true,
    scales:{x:{stacked:true,ticks:{maxRotation:90,minRotation:45}},
            y:{stacked:true,title:{display:true,text:'unhelpful  ←  notes  →  helpful'},
               ticks:{callback:(v)=>Math.abs(v)}}},
    plugins:{
      legend:{labels:{filter:(it)=>!DS[it.datasetIndex].isUnhelpful}},
      tooltip:{callbacks:{
        title:(x)=>x[0].label,
        label:(x)=>{const d=DS[x.datasetIndex];const bot=d.label.replace(' (unhelpful)','');
          const n=Math.abs(x.raw);if(!n)return null;
          return bot+': '+n+(d.isUnhelpful?' unhelpful':' helpful');}}}}
  }
});
</script></body></html>`;

    const out = join(tmpdir(), "bot-daily.html");
    writeFileSync(out, html);
    console.log(`[botBreakdown] Wrote daily chart → ${out}  (${bots.length} bots: ${bots.join(", ")})`);
    try { execSync(`open "${out}"`); } catch { /* The open command only exists on macOS. */ }
  }
}
