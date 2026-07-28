/**
 * Build Calibration Sample
 *
 * Downloads X's public CN data dump, samples 100 Helpful + 100 Not Helpful notes,
 * fetches tweet text via X API, runs scoring functions, and saves results.
 *
 * Usage:
 *   bun run tmp/calibration/buildCalibrationSample.ts              # Full run (download + score)
 *   bun run tmp/calibration/buildCalibrationSample.ts --score-only  # Re-score existing sample
 *   bun run tmp/calibration/buildCalibrationSample.ts --human       # Human prediction mode
 */

import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { createInterface } from "readline";

// ─── Config ──────────────────────────────────────────────────────────────────

const CN_DATA_BASE_URL = "https://ton.twimg.com/birdwatch-public-data";
const DATA_DIR = "./cn-data";
const OUTPUT_DIR = "./data/calibration";
const SAMPLE_FILE = `${OUTPUT_DIR}/sample.json`;
const RESULTS_FILE = `${OUTPUT_DIR}/results.json`;
const CSV_FILE = `${OUTPUT_DIR}/results.csv`;
const SAMPLE_SIZE = 100; // per status (100 H + 100 NH)

// ─── Types ───────────────────────────────────────────────────────────────────

interface SampledNote {
  noteId: string;
  tweetId: string;
  authorParticipantId: string;
  noteText: string;
  classification: string;
  createdAtMillis: number;
  // From noteStatusHistory
  currentStatus: string; // CURRENTLY_RATED_HELPFUL or CURRENTLY_RATED_NOT_HELPFUL
  coreNoteIntercept: number | null;
  // Fetched via X API
  tweetText: string | null;
  tweetDeleted: boolean;
}

interface ScoredNote extends SampledNote {
  scores: {
    sourceCount: number;
    sourceTrust: number;
    sourceTrustTier: string;
    sourceDomains: string[];
    noteLength: number;
    tone: number | null;
    toneReasoning: string | null;
    saysWrong: number | null;
    saysWrongReasoning: string | null;
    bridging: number | null;
    bridgingReasoning: string | null;
    humanPrediction: number | null;
    humanShouldPost: number | null;
  };
}

// ─── Step 1: Download public data ────────────────────────────────────────────

function formatDateForUrl(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

async function downloadCNFile(
  fileType: "noteStatusHistory" | "notes",
  partition: string = "00000"
): Promise<string | null> {
  const zipFileName = `${fileType}-${partition}.zip`;
  const tsvFileName = `${fileType}-${partition}.tsv`;
  const zipPath = `${DATA_DIR}/${zipFileName}`;
  const tsvPath = `${DATA_DIR}/${tsvFileName}`;

  // Reuse if already downloaded today
  if (existsSync(tsvPath)) {
    const stat = Bun.file(tsvPath);
    const age = Date.now() - (await stat.lastModified);
    if (age < 12 * 60 * 60 * 1000) {
      console.log(`[sample] Reusing cached ${fileType} (${(age / 3600000).toFixed(1)}h old)`);
      return tsvPath;
    }
  }

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  for (let daysBack = 0; daysBack < 7; daysBack++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - daysBack);
    const dateStr = formatDateForUrl(date);
    const url = `${CN_DATA_BASE_URL}/${dateStr}/${fileType}/${zipFileName}`;

    try {
      console.log(`[sample] Downloading ${url}...`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      writeFileSync(zipPath, Buffer.from(buffer));
      execSync(`unzip -o "${zipPath}" -d "${DATA_DIR}"`, { stdio: "pipe" });
      unlinkSync(zipPath);
      console.log(`[sample] Got ${fileType} from ${dateStr}`);
      return tsvPath;
    } catch {
      if (daysBack < 6) console.log(`[sample] No ${fileType} for ${dateStr}, trying earlier...`);
    }
  }

  console.error(`[sample] Could not find ${fileType} data`);
  return null;
}

// ─── Step 2: Parse and sample ────────────────────────────────────────────────

function parseTsv(path: string): { headers: string[]; rows: string[][] } {
  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  const headers = lines[0]!.split("\t");
  const rows = lines.slice(1).map((l) => l.split("\t"));
  return { headers, rows };
}

async function buildSample(): Promise<SampledNote[]> {
  // Download both files — we need all partitions for a good sample
  // But start with partition 00000 (most notes are here)
  const notesPath = await downloadCNFile("notes", "00000");
  const statusPath = await downloadCNFile("noteStatusHistory", "00000");
  if (!notesPath || !statusPath) throw new Error("Failed to download data files");

  console.log("[sample] Parsing noteStatusHistory...");
  const status = parseTsv(statusPath);
  const sIdx = {
    noteId: status.headers.indexOf("noteId"),
    currentStatus: status.headers.indexOf("currentStatus"),
    coreNoteIntercept: status.headers.indexOf("coreNoteIntercept"),
  };

  // Build status map: noteId -> { status, intercept }
  const statusMap = new Map<string, { status: string; intercept: number | null }>();
  for (const row of status.rows) {
    const noteId = row[sIdx.noteId]!;
    const currentStatus = row[sIdx.currentStatus]!;
    const interceptStr = row[sIdx.coreNoteIntercept];
    const intercept = interceptStr ? parseFloat(interceptStr) : null;
    statusMap.set(noteId, { status: currentStatus, intercept: isNaN(intercept!) ? null : intercept });
  }

  console.log(`[sample] ${statusMap.size} notes in status history`);

  // Parse notes file
  console.log("[sample] Parsing notes file...");
  const notes = parseTsv(notesPath);
  const nIdx = {
    noteId: notes.headers.indexOf("noteId"),
    tweetId: notes.headers.indexOf("tweetId"),
    author: notes.headers.indexOf("noteAuthorParticipantId"),
    createdAtMillis: notes.headers.indexOf("createdAtMillis"),
    classification: notes.headers.indexOf("classification"),
    summary: notes.headers.indexOf("summary"),
  };

  // Collect H and NH notes
  const helpful: SampledNote[] = [];
  const notHelpful: SampledNote[] = [];

  for (const row of notes.rows) {
    const noteId = row[nIdx.noteId]!;
    const statusInfo = statusMap.get(noteId);
    if (!statusInfo) continue;

    const noteText = row[nIdx.summary] || "";
    if (!noteText || noteText.length < 20) continue; // Skip empty/trivial notes

    const tweetId = row[nIdx.tweetId]!;
    if (!tweetId || !/^\d{10,20}$/.test(tweetId)) continue;

    const note: SampledNote = {
      noteId,
      tweetId,
      authorParticipantId: row[nIdx.author] || "",
      noteText,
      classification: row[nIdx.classification] || "",
      createdAtMillis: parseInt(row[nIdx.createdAtMillis] || "0"),
      currentStatus: statusInfo.status,
      coreNoteIntercept: statusInfo.intercept,
      tweetText: null,
      tweetDeleted: false,
    };

    if (statusInfo.status === "CURRENTLY_RATED_HELPFUL") {
      helpful.push(note);
    } else if (statusInfo.status === "CURRENTLY_RATED_NOT_HELPFUL") {
      notHelpful.push(note);
    }
  }

  console.log(`[sample] Found ${helpful.length} helpful, ${notHelpful.length} not helpful notes`);

  // Random sample
  const shuffle = <T>(arr: T[]) => arr.sort(() => Math.random() - 0.5);
  const sampledH = shuffle(helpful).slice(0, SAMPLE_SIZE);
  const sampledNH = shuffle(notHelpful).slice(0, SAMPLE_SIZE);
  const sample = shuffle([...sampledH, ...sampledNH]);

  console.log(`[sample] Sampled ${sampledH.length} H + ${sampledNH.length} NH = ${sample.length} total`);
  return sample;
}

// ─── Step 3: Fetch tweet text via X API ──────────────────────────────────────

async function fetchTweetTexts(sample: SampledNote[]): Promise<void> {
  const apiKey = process.env.X_NATHANPMYOUNG_API_KEY;
  const apiSecret = process.env.X_NATHANPMYOUNG_API_KEY_SECRET;
  const accessToken = process.env.X_NATHANPMYOUNG_ACCESS_TOKEN;
  const accessSecret = process.env.X_NATHANPMYOUNG_ACCESS_TOKEN_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    console.warn("[sample] No X_NATHANPMYOUNG keys in .env — skipping tweet text fetch");
    return;
  }

  const crypto = await import("crypto");
  const OAuth = (await import("oauth-1.0a")).default;
  const oauth = new OAuth({
    consumer: { key: apiKey, secret: apiSecret },
    signature_method: "HMAC-SHA1",
    hash_function(base_string: string, key: string) {
      return crypto.createHmac("sha1", key).update(base_string).digest("base64");
    },
  });
  const token = { key: accessToken, secret: accessSecret };

  const tweetIds = [...new Set(sample.map((n) => n.tweetId))];
  console.log(`[sample] Fetching ${tweetIds.length} tweets via X API (nathanpmyoung OAuth1)...`);

  const tweetTextMap = new Map<string, string>();
  const deletedIds = new Set<string>();

  // X API allows 100 tweets per lookup request
  for (let i = 0; i < tweetIds.length; i += 100) {
    const batch = tweetIds.slice(i, i + 100);
    const url = `https://api.x.com/2/tweets?ids=${batch.join(",")}&tweet.fields=text`;
    const authHeader = oauth.toHeader(oauth.authorize({ url, method: "GET" }, token));

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { ...authHeader, "Content-Type": "application/json" },
      });

      if (!response.ok) {
        console.warn(`[sample] Tweet lookup failed: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json() as any;
      if (data.data) {
        for (const tweet of data.data) {
          tweetTextMap.set(tweet.id, tweet.text);
        }
      }
      if (data.errors) {
        for (const err of data.errors) {
          deletedIds.add(err.resource_id || err.value);
        }
      }

      console.log(`[sample] Batch ${Math.floor(i / 100) + 1}: got ${data.data?.length ?? 0} tweets, ${data.errors?.length ?? 0} errors`);

      // Rate limit courtesy
      if (i + 100 < tweetIds.length) await new Promise((r) => setTimeout(r, 1000));
    } catch (err: any) {
      console.warn(`[sample] Tweet batch failed:`, err?.message);
    }
  }

  // Apply to sample
  let found = 0, deleted = 0;
  for (const note of sample) {
    const text = tweetTextMap.get(note.tweetId);
    if (text) {
      note.tweetText = text;
      found++;
    } else if (deletedIds.has(note.tweetId)) {
      note.tweetDeleted = true;
      deleted++;
    }
  }

  console.log(`[sample] Tweet text: ${found} found, ${deleted} deleted, ${sample.length - found - deleted} unknown`);
}

// ─── Step 4: Scoring ─────────────────────────────────────────────────────────

function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s"'<>)\]]+/g;
  return text.match(urlRegex) || [];
}

function scoreSourceCount(noteText: string): { count: number; domains: string[] } {
  const urls = extractUrls(noteText);
  const domains = urls.map((u) => {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
  }).filter(Boolean);
  return { count: urls.length, domains: [...new Set(domains)] };
}

async function scoreLLM(
  prompt: string,
  model: string = "anthropic/claude-sonnet-4"
): Promise<{ score: number; reasoning: string }> {
  const { llm } = await import("../pipeline/llm");
  const result = await llm.create({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const content = result.choices?.[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(content);
    return {
      score: typeof parsed.score === "number" ? parsed.score : 0.5,
      reasoning: parsed.reasoning || "",
    };
  } catch {
    return { score: 0.5, reasoning: "Parse error" };
  }
}

async function scoreTone(noteText: string): Promise<{ score: number; reasoning: string }> {
  return scoreLLM(`Rate the tone of this Community Note on a scale from 0 (aggressive/partisan/judgmental) to 1 (neutral/measured/informational).

Community Note: "${noteText}"

Consider:
- Does it use neutral, factual language?
- Does it avoid loaded words, sarcasm, or condescension?
- Would someone who disagrees with the correction still find the tone respectful?

Scoring:
- 0.0-0.2: Aggressive, mocking, or heavily partisan
- 0.3-0.4: Somewhat biased or judgmental tone
- 0.5-0.6: Mostly neutral with minor tone issues
- 0.7-0.8: Neutral and informational
- 0.9-1.0: Perfectly measured, encyclopedic tone

Return ONLY a JSON object with: score (number 0-1), reasoning (one sentence).`);
}

async function scoreSaysWrong(
  noteText: string,
  tweetText: string | null
): Promise<{ score: number; reasoning: string }> {
  const tweetContext = tweetText ? `Original tweet: "${tweetText}"\n\n` : "";
  return scoreLLM(`${tweetContext}Evaluate how strongly this Community Note characterizes the original post as "wrong" or "false" vs just providing additional context.

Community Note: "${noteText}"

Scoring:
- 0.0: Just adds context without implying the post is wrong
- 0.3: Implies the post is misleading but gently
- 0.5: Clearly says the post is inaccurate
- 0.7: Strongly says the post is wrong/false
- 1.0: Harshly declares the post is completely wrong

Return ONLY a JSON object with: score (number 0-1), reasoning (one sentence).`);
}

async function scoreBridging(
  noteText: string,
  tweetText: string | null
): Promise<{ score: number; reasoning: string }> {
  const tweetContext = tweetText ? `Original tweet: "${tweetText}"\n\n` : "";
  return scoreLLM(`${tweetContext}Predict whether people across the political spectrum would agree this Community Note is helpful. X's Community Notes algorithm specifically requires "bridging" — notes only display if BOTH left-leaning and right-leaning raters agree.

Community Note: "${noteText}"

Consider:
- Is the correction based on verifiable facts rather than interpretation?
- Does it avoid partisan framing?
- Would someone who agrees with the original tweet still accept this correction?
- Is the source cited one that both sides would trust?

Scoring:
- 0.0-0.2: Only one political side would find this helpful (partisan correction)
- 0.3-0.4: Somewhat partisan, unlikely to bridge
- 0.5-0.6: Mixed — some bridging potential but debatable
- 0.7-0.8: Good bridging — factual, neutral, widely acceptable
- 0.9-1.0: Excellent bridging — verifiable fact, trusted source, no partisan angle

Return ONLY a JSON object with: score (number 0-1), reasoning (one sentence).`);
}

async function scoreAllNotes(sample: SampledNote[]): Promise<ScoredNote[]> {
  const { scoreSourceTrustworthiness } = await import("../pipeline/sourceTrustworthiness");

  const results: ScoredNote[] = [];
  const total = sample.length;

  // Process in batches of 5 to avoid rate limits
  for (let i = 0; i < sample.length; i += 5) {
    const batch = sample.slice(i, i + 5);
    console.log(`[score] Scoring batch ${Math.floor(i / 5) + 1}/${Math.ceil(total / 5)} (notes ${i + 1}-${i + batch.length})...`);

    const batchResults = await Promise.all(
      batch.map(async (note) => {
        // Free scores
        const { count: sourceCount, domains: sourceDomains } = scoreSourceCount(note.noteText);
        const urls = extractUrls(note.noteText);
        const primaryUrl = urls[0] || "";
        const trustResult = primaryUrl
          ? scoreSourceTrustworthiness(primaryUrl)
          : { score: 0.5, tier: "unknown" as const };

        // LLM scores (parallel)
        const [toneResult, wrongResult, bridgingResult] = await Promise.all([
          scoreTone(note.noteText),
          scoreSaysWrong(note.noteText, note.tweetText),
          scoreBridging(note.noteText, note.tweetText),
        ]);

        return {
          ...note,
          scores: {
            sourceCount,
            sourceTrust: trustResult.score,
            sourceTrustTier: trustResult.tier,
            sourceDomains,
            noteLength: note.noteText.length,
            tone: toneResult.score,
            toneReasoning: toneResult.reasoning,
            saysWrong: wrongResult.score,
            saysWrongReasoning: wrongResult.reasoning,
            bridging: bridgingResult.score,
            bridgingReasoning: bridgingResult.reasoning,
            humanPrediction: null,
            humanShouldPost: null,
          },
        } as ScoredNote;
      })
    );

    results.push(...batchResults);

    // Save progress after each batch
    writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  }

  return results;
}

// ─── Step 5: Save results ────────────────────────────────────────────────────

function saveCSV(results: ScoredNote[]): void {
  const headers = [
    "noteId", "tweetId", "currentStatus", "coreNoteIntercept",
    "noteLength", "sourceCount", "sourceTrust", "sourceTrustTier",
    "sourceDomains", "tone", "saysWrong", "bridging",
    "humanPrediction", "humanShouldPost", "tweetText", "noteText",
  ];

  const rows = results.map((r) => [
    r.noteId,
    r.tweetId,
    r.currentStatus,
    r.coreNoteIntercept ?? "",
    r.scores.noteLength,
    r.scores.sourceCount,
    r.scores.sourceTrust,
    r.scores.sourceTrustTier,
    r.scores.sourceDomains.join("; "),
    r.scores.tone ?? "",
    r.scores.saysWrong ?? "",
    r.scores.bridging ?? "",
    r.scores.humanPrediction ?? "",
    r.scores.humanShouldPost ?? "",
    `"${(r.tweetText || "").replace(/"/g, '""')}"`,
    `"${(r.noteText || "").replace(/"/g, '""')}"`,
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  writeFileSync(CSV_FILE, csv);
}

// ─── Step 6: Human prediction mode ──────────────────────────────────────────

async function humanPredictMode(): Promise<void> {
  if (!existsSync(RESULTS_FILE)) {
    console.error("No results file found. Run without --human first.");
    process.exit(1);
  }

  const results: ScoredNote[] = JSON.parse(readFileSync(RESULTS_FILE, "utf-8"));
  const unpredicted = results.filter((r) => r.scores.humanPrediction === null);
  console.log(`\n${unpredicted.length} notes remaining (${results.length - unpredicted.length} already predicted)\n`);

  if (unpredicted.length === 0) {
    console.log("All notes have human predictions!");
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

  let predicted = 0;
  for (const note of unpredicted) {
    console.log("─".repeat(70));
    if (note.tweetText) {
      console.log(`\nTWEET: ${note.tweetText}\n`);
    } else {
      console.log(`\nTWEET: [${note.tweetDeleted ? "deleted" : "unavailable"}] (tweet ID: ${note.tweetId})\n`);
    }
    console.log(`NOTE: ${note.noteText}\n`);
    console.log(`Scores: bridging=${note.scores.bridging?.toFixed(2)} saysWrong=${note.scores.saysWrong?.toFixed(2)} tone=${note.scores.tone?.toFixed(2)} sources=${note.scores.sourceCount}`);

    const answer = await ask("\nWill this be rated Helpful? (0-1, 's' to skip, 'q' to quit): ");

    if (answer === "q") break;
    if (answer === "s") continue;

    const score = parseFloat(answer);
    if (isNaN(score) || score < 0 || score > 1) {
      console.log("Invalid input, skipping");
      continue;
    }

    note.scores.humanPrediction = score;

    const postAnswer = await ask("Should we post this? (0-1, 's' to skip): ");
    if (postAnswer !== "s") {
      const postScore = parseFloat(postAnswer);
      if (!isNaN(postScore) && postScore >= 0 && postScore <= 1) {
        note.scores.humanShouldPost = postScore;
      }
    }

    predicted++;

    // Save after each prediction
    writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    saveCSV(results);
  }

  rl.close();
  console.log(`\nSaved ${predicted} predictions. Total: ${results.filter((r) => r.scores.humanPrediction !== null).length}/${results.length}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const args = process.argv.slice(2);

  if (args.includes("--human")) {
    await humanPredictMode();
    return;
  }

  let sample: SampledNote[];

  if (args.includes("--score-only") && existsSync(SAMPLE_FILE)) {
    console.log("[sample] Loading existing sample...");
    sample = JSON.parse(readFileSync(SAMPLE_FILE, "utf-8"));
  } else {
    // Build fresh sample
    sample = await buildSample();

    // Fetch tweet texts
    await fetchTweetTexts(sample);

    // Save sample (before scoring, so we can re-score later)
    writeFileSync(SAMPLE_FILE, JSON.stringify(sample, null, 2));
    console.log(`[sample] Saved sample to ${SAMPLE_FILE}`);
  }

  // Score all notes
  console.log(`\n[score] Scoring ${sample.length} notes...`);
  const results = await scoreAllNotes(sample);

  // Save results
  writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  saveCSV(results);

  // Summary stats
  const helpful = results.filter((r) => r.currentStatus === "CURRENTLY_RATED_HELPFUL");
  const notHelpful = results.filter((r) => r.currentStatus === "CURRENTLY_RATED_NOT_HELPFUL");

  console.log("\n═══ CALIBRATION SAMPLE SUMMARY ═══");
  console.log(`Total: ${results.length} (${helpful.length} H, ${notHelpful.length} NH)`);
  console.log(`Tweets found: ${results.filter((r) => r.tweetText).length}/${results.length}`);

  // Domain frequency
  const domainCounts = new Map<string, { h: number; nh: number }>();
  for (const r of results) {
    for (const d of r.scores.sourceDomains) {
      if (!domainCounts.has(d)) domainCounts.set(d, { h: 0, nh: 0 });
      if (r.currentStatus === "CURRENTLY_RATED_HELPFUL") domainCounts.get(d)!.h++;
      else domainCounts.get(d)!.nh++;
    }
  }

  console.log("\n─── Top domains (H / NH) ───");
  const sortedDomains = [...domainCounts.entries()]
    .sort((a, b) => (b[1].h + b[1].nh) - (a[1].h + a[1].nh))
    .slice(0, 20);
  for (const [domain, counts] of sortedDomains) {
    const inList = existsSync("") ? "?" : ""; // placeholder
    console.log(`  ${domain}: ${counts.h} H / ${counts.nh} NH`);
  }

  // Score averages by status
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  console.log("\n─── Average scores (H vs NH) ───");
  console.log(`  Note length: ${avg(helpful.map((r) => r.scores.noteLength)).toFixed(0)} vs ${avg(notHelpful.map((r) => r.scores.noteLength)).toFixed(0)}`);
  console.log(`  Source count: ${avg(helpful.map((r) => r.scores.sourceCount)).toFixed(2)} vs ${avg(notHelpful.map((r) => r.scores.sourceCount)).toFixed(2)}`);
  console.log(`  Source trust: ${avg(helpful.map((r) => r.scores.sourceTrust)).toFixed(3)} vs ${avg(notHelpful.map((r) => r.scores.sourceTrust)).toFixed(3)}`);
  console.log(`  Tone: ${avg(helpful.filter((r) => r.scores.tone !== null).map((r) => r.scores.tone!)).toFixed(3)} vs ${avg(notHelpful.filter((r) => r.scores.tone !== null).map((r) => r.scores.tone!)).toFixed(3)}`);
  console.log(`  Says wrong: ${avg(helpful.filter((r) => r.scores.saysWrong !== null).map((r) => r.scores.saysWrong!)).toFixed(3)} vs ${avg(notHelpful.filter((r) => r.scores.saysWrong !== null).map((r) => r.scores.saysWrong!)).toFixed(3)}`);
  console.log(`  Bridging: ${avg(helpful.filter((r) => r.scores.bridging !== null).map((r) => r.scores.bridging!)).toFixed(3)} vs ${avg(notHelpful.filter((r) => r.scores.bridging !== null).map((r) => r.scores.bridging!)).toFixed(3)}`);

  console.log(`\nResults saved to:\n  ${RESULTS_FILE}\n  ${CSV_FILE}`);
  console.log(`\nRun with --human to add your predictions.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
