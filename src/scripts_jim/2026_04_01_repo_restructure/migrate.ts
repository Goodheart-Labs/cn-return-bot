import { Project } from "ts-morph";
import path from "path";
import fs from "fs";

const ROOT = path.resolve(import.meta.dir, "../..");

const project = new Project({
  tsConfigFilePath: path.join(ROOT, "tsconfig.json"),
});

function moveFile(from: string, toDir: string) {
  const file = project.getSourceFile(path.join(ROOT, from));
  if (!file) {
    console.warn(`  SKIP (not found): ${from}`);
    return;
  }
  const absDir = path.join(ROOT, toDir);
  fs.mkdirSync(absDir, { recursive: true });
  file.moveToDirectory(absDir);
  console.log(`  ${from} → ${toDir}/`);
}

function deleteFile(filePath: string) {
  const file = project.getSourceFile(path.join(ROOT, filePath));
  if (file) {
    file.delete();
    console.log(`  DELETE ${filePath}`);
  } else {
    console.warn(`  SKIP DELETE (not found): ${filePath}`);
  }
}

// ── 1. Pipeline subfolders ──────────────────────────────────────────────

console.log("\n1. Pipeline → search/");
for (const f of [
  "searchContextGoal.ts",
  "enrichedSearch.ts",
  "grokSearch.ts",
  "researchLoop.ts",
  "deepFactVerification.ts",
]) {
  moveFile(`src/pipeline/${f}`, "src/pipeline/search");
}

console.log("\n2. Pipeline → write/");
for (const f of [
  "writeNote.ts",
  "writeNoteDirect.ts",
  "writeNoteBridging.ts",
  "writeNoteMultiSource.ts",
]) {
  moveFile(`src/pipeline/${f}`, "src/pipeline/write");
}
moveFile("src/pipeline/legacy/writeNoteLegacy.ts", "src/pipeline/write");

console.log("\n3. Pipeline → verify/");
for (const f of ["sourceVerification.ts", "sourceTrustworthiness.ts"]) {
  moveFile(`src/pipeline/${f}`, "src/pipeline/verify");
}

console.log("\n4. Pipeline → score/");
for (const f of ["noteScores.ts", "candidateRanker.ts"]) {
  moveFile(`src/pipeline/${f}`, "src/pipeline/score");
}
moveFile("src/filters/noteEvaluationFilter.ts", "src/pipeline/score");

console.log("\n5. Pipeline → llm/");
for (const f of ["llm.ts", "xai.ts", "schemas.ts"]) {
  moveFile(`src/pipeline/${f}`, "src/pipeline/llm");
}

console.log("\n6. Pipeline → media/");
moveFile("src/pipeline/mediaAnalysis.ts", "src/pipeline/media");

console.log("\n7. Pipeline → orchestration/");
for (const f of [
  "processTweet.ts",
  "feedSizeStrategy.ts",
  "tweetSorting.ts",
]) {
  moveFile(`src/pipeline/${f}`, "src/pipeline/orchestration");
}
moveFile("src/scripts/generateCandidates.ts", "src/pipeline/orchestration");
moveFile("src/scripts/submitCandidates.ts", "src/pipeline/orchestration");

console.log("\n8. Pipeline → utils/");
for (const f of [
  "tweetLog.ts",
  "browserManager.ts",
  "parseStatusNoteUrl.ts",
]) {
  moveFile(`src/pipeline/${f}`, "src/pipeline/utils");
}

// ── 2. Production ───────────────────────────────────────────────────────

console.log("\n9. src/production/");
moveFile("src/scripts/runPipeline.ts", "src/production");
moveFile("src/scripts/updateNoteFeedback.ts", "src/production");

// ── 3. Local ────────────────────────────────────────────────────────────

console.log("\n10. src/local/");
for (const f of [
  "localPipelineRunner.ts",
  "tryoutNotes.ts",
  "runOnVideos.ts",
  "evaluateResults.ts",
]) {
  moveFile(`src/scripts/${f}`, "src/local");
}

// ── 4. Scraper ──────────────────────────────────────────────────────────

console.log("\n11. src/scraper/");
for (const f of [
  "scrapeNotewriterClickThrough.ts",
  "scrollAndScrape.ts",
  "scrollDown.ts",
  "scrollToMiddle.ts",
  "reconcileSnapshots.ts",
]) {
  moveFile(`src/scripts/${f}`, "src/scraper");
}

// ── 5. Delete dead files ────────────────────────────────────────────────

console.log("\n12. Delete dead files");
deleteFile("src/scripts/createNotesRoutine.ts");
deleteFile("src/pipeline/predictionScores.ts");
deleteFile("src/pipeline/parseStatusNoteUrl.test.ts");
deleteFile("src/tests/noteEvaluationFilter.test.ts");
deleteFile("src/tests/manual-filter-test.ts");

// ── 6. scripts_nathan ───────────────────────────────────────────────────

const nathanMoves: Record<string, string[]> = {
  "src/scripts_nathan/2025_10_04_v1_pipeline": ["index.ts", "run.ts"],
  "src/scripts_nathan/2026_01_09_scraper_imports": ["importScrapedNotes.ts"],
  "src/scripts_nathan/2026_01_12_notewriter_import": [
    "importNotewriterData.ts",
  ],
  "src/scripts_nathan/2026_01_31_view_analysis": [
    "analyzeViewConsistency.ts",
    "auditData.ts",
    "calculateTotalViews.ts",
    "generateDailyNotesReport.ts",
  ],
  "src/scripts_nathan/2026_02_16_debug_and_analysis": [
    "checkSpecificNote.ts",
    "debugFailingNotes.ts",
    "debugNotes.ts",
    "evaluatePredictors.ts",
    "findFailingTweets.ts",
    "findUntrackedNotes.ts",
    "humanPredict.ts",
    "listHelpfulNotesHtml.ts",
    "testOpusResearch.ts",
    "viewsByNoteDate.ts",
  ],
  "src/scripts_nathan/2026_02_17_bulk_analysis": [
    "analyzeByBot.ts",
    "analyzeNotePatterns.ts",
    "analyzePerformance.ts",
    "checkAllStatuses.ts",
    "checkNotShown.ts",
    "checkNoteStats.ts",
    "checkPostingStats.ts",
    "checkRomoSnapshot.ts",
    "debugNote.ts",
    "debugNotewriterViews.ts",
    "exploreChartData.ts",
    "findRomoNote.ts",
    "findScraperProblems.ts",
    "importNewScrapedNotes.ts",
    "investigateNotesMatch.ts",
    "listHelpfulNotes.ts",
    "listNotes.ts",
    "pipelineErrorStats.ts",
    "tempFullReport.ts",
    "tempQueryNotes.ts",
  ],
};

console.log("\n13. scripts_nathan/");
for (const [dir, files] of Object.entries(nathanMoves)) {
  for (const f of files) {
    moveFile(`src/scripts/${f}`, dir);
  }
}

// ── 7. Save ─────────────────────────────────────────────────────────────

console.log("\nSaving all changes...");
project.saveSync();
console.log("Done! All files moved and imports updated.");

// ── 8. Move posts.json (not a TS file, ts-morph won't handle it) ────────

const postsFrom = path.join(ROOT, "src/pipeline/posts.json");
const postsTo = path.join(ROOT, "src/pipeline/utils/posts.json");
if (fs.existsSync(postsFrom)) {
  fs.renameSync(postsFrom, postsTo);
  console.log("  src/pipeline/posts.json → src/pipeline/utils/");
}
