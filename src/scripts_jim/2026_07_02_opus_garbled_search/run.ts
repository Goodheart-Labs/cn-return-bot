/**
 * Reproduce the opus48-native simple-bot search step to measure how often
 * Claude Opus 4.8 returns a "garbled" findings string (token-salad) via the
 * native web-search path.
 *
 * Faithful reproduction: calls the real dispatchSearch() under withBotConfig
 * with the opus48-native variant overrides (search_model=anthropic/claude-opus-4.8,
 * web_search=native), using the exact userMessage from the prod log. The system
 * prompt, WEB_SEARCH_TOOL, json_schema response_format and provider.require_parameters
 * routing all come from the production code path — nothing is re-specified here.
 *
 * Usage: bun run src/scripts_jim/2026_07_02_opus_garbled_search/run.ts [N] [concurrency]
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { withBotConfig, DEFAULT_CONFIG, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { dispatchSearch } from "../../pipeline/simple-bot/searchDispatch";

const N = Number(process.argv[2] ?? 30);
const CONCURRENCY = Number(process.argv[3] ?? 6);

const userMessage = readFileSync(join(import.meta.dir, "userMessage.txt"), "utf8");

// opus48-native variant from SIMPLE_BOT_SEARCH_TEST (abTestsData.ts).
const config: BotConfig = {
  ...DEFAULT_CONFIG,
  botId: "simple-bot",
  search_model: "anthropic/claude-opus-4.8",
  web_search: "native",
};

// A normal findings summary is dense (hundreds–thousands of chars) and cites
// https:// URLs. The garbled failure was 46 chars of token-salad with no URL.
const SHORT_FINDINGS_LEN = 250;
// Runs of >=4 bracket/slash chars ("</</</") never appear in a real URL
// ("https://" is only 2 slashes) — a clean token-salad marker.
const SALAD_RUN = /[<>\/]{4,}/;
// Leaked tool-call / XML control tokens: the model dumps its native tool-use
// syntax into the JSON text channel ("<invoke name=", "</p>", "test_>", the
// literal token name "dquote"). None occur in a real research summary.
const CONTROL_LEAK = /<invoke\b|<\/?antml|<\/?[a-z][a-z0-9]*>|test_>|\bdquote\b/i;

interface RunResult {
  i: number;
  ms: number;
  ok: boolean;
  error?: string;
  correctionNeeded?: boolean;
  findingsLen?: number;
  hasHttps?: boolean;
  saladMarker?: boolean;
  garbled?: boolean;
  findings?: string;
}

function classify(findings: string): Pick<RunResult, "findingsLen" | "hasHttps" | "saladMarker" | "garbled"> {
  const findingsLen = findings.length;
  const hasHttps = /https?:\/\//.test(findings);
  const saladMarker = SALAD_RUN.test(findings) || CONTROL_LEAK.test(findings);
  const short = findingsLen < SHORT_FINDINGS_LEN;
  // Garbled = obvious token-salad, OR a suspiciously short summary that cites
  // no source at all (the demonstrated failure mode). Printed in full below so
  // the classification stays auditable.
  const garbled = saladMarker || (short && !hasHttps);
  return { findingsLen, hasHttps, saladMarker, garbled };
}

async function runOnce(i: number): Promise<RunResult> {
  const start = Date.now();
  try {
    const { findings, correctionNeeded } = await withBotConfig(config, () =>
      dispatchSearch(userMessage, "search"),
    );
    const ms = Date.now() - start;
    return { i, ms, ok: true, correctionNeeded, findings, ...classify(findings) };
  } catch (err: any) {
    return { i, ms: Date.now() - start, ok: false, error: String(err?.message ?? err) };
  }
}

async function pool<T>(items: number[], size: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = items[cursor++];
      const r = await fn(i);
      results.push(r);
      const done = results.length;
      const tag = (r as any).ok ? ((r as any).garbled ? "GARBLED" : "ok") : "ERROR";
      console.log(`[${done}/${items.length}] run ${i}: ${tag} (${(r as any).ms}ms, len=${(r as any).findingsLen ?? "-"})`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

console.log(`Rerunning opus48-native search ${N}× (concurrency ${CONCURRENCY}), model=${config.search_model}\n`);

const results = await pool(Array.from({ length: N }, (_, i) => i), CONCURRENCY, runOnce);
results.sort((a, b) => a.i - b.i);

const outPath = join(import.meta.dir, "results.jsonl");
writeFileSync(outPath, results.map((r) => JSON.stringify(r)).join("\n") + "\n");

const ok = results.filter((r) => r.ok);
const errored = results.filter((r) => !r.ok);
const garbled = ok.filter((r) => r.garbled);
const cleanOk = ok.filter((r) => !r.garbled);

// Sub-classify the hard errors by the content the model produced before it broke.
const errEmpty = errored.filter((r) => /content=""$/.test(r.error ?? ""));
const errSalad = errored.filter((r) => !/content=""$/.test(r.error ?? ""));
// "Corrupted" = any run whose output was unusable: hard error OR silent salad.
const corrupted = errored.length + garbled.length;

console.log("\n===== SUMMARY =====");
console.log(`total runs:              ${results.length}`);
console.log(`clean usable findings:   ${cleanOk.length}`);
console.log(`CORRUPTED (unusable):    ${corrupted}  (${((corrupted / results.length) * 100).toFixed(1)}%)`);
console.log(`  ├─ silent garble:      ${garbled.length}  (valid JSON, salad findings — slips through to note-writer)`);
console.log(`  ├─ invalid-JSON error: ${errSalad.length}  (salad broke JSON → ModelOutputInvalidError, tweet fails)`);
console.log(`  └─ empty after retry:  ${errEmpty.length}  (all ${'4'} attempts returned empty content)`);
console.log(`raw saved to:            ${outPath}`);

if (garbled.length) {
  console.log("\n----- GARBLED OUTPUTS (full) -----");
  for (const r of garbled) {
    console.log(`\n#${r.i} len=${r.findingsLen} hasHttps=${r.hasHttps} salad=${r.saladMarker} correction=${r.correctionNeeded}`);
    console.log(JSON.stringify(r.findings));
  }
}

if (errored.length) {
  console.log("\n----- HARD ERRORS -----");
  for (const r of errored) console.log(`#${r.i}: ${r.error}`);
}

// Show the shortest non-garbled completion too, as a sanity check on the threshold.
const shortestOk = ok.filter((r) => !r.garbled).sort((a, b) => (a.findingsLen ?? 0) - (b.findingsLen ?? 0))[0];
if (shortestOk) {
  console.log(`\n----- shortest NON-garbled completion (#${shortestOk.i}, len=${shortestOk.findingsLen}) for threshold sanity -----`);
  console.log(shortestOk.findings?.slice(0, 600));
}
