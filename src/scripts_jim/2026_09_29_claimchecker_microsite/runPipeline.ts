/**
 * Runs the Common Notes pipeline on the archived article and saves the result
 * as one lab run, which the microsite then shows.
 *
 * It calls the same functions the production services call, in this process:
 * extraction (the gate and split, the image descriptions and the per-part
 * extraction), the rating of each part with Muse's native search, and the
 * claim check of every claim rated uncertain or worse. It writes nothing to
 * the production database.
 *
 * A run can start from an earlier run instead of from scratch. With
 * `--reuse extraction` it takes that run's extracted claims and redoes the
 * rating and the checks. With `--reuse rating` it also takes the ratings and
 * only redoes the checks. Differences between the two runs then come from the
 * code that changed, not from chance in the steps that did not.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/runPipeline.ts --label "<what changed>"
 *       [--from <run id> --reuse extraction|rating] [--limit <n>]
 *
 *   --limit <n>  checks only the first n claims worth checking, for a cheap smoke test
 */

import "dotenv/config";
import { execSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import PQueue from "p-queue";
import { buildClaimPost, runClaimCheck } from "../../everything/pipeline/checkClaims";
import { extractClaims } from "../../everything/pipeline/extractClaims";
import { freshClaimsPerPart, rateParts } from "../../everything/pipeline/processContent";
import { rateClaims, shouldFactCheck } from "../../everything/pipeline/rateClaims";
import type { ExtractionResult, FetchedContent, RatedClaim } from "../../everything/types";
import { aggregateAndLogCosts, withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { closeBrowser } from "../../pipeline/utils/browserManager";
import type { LabClaim, LabRun, Stage } from "./labRun";
import { LOGS_DIR, STAGES_DIR, readArticle, saveRun } from "./runStore";

/** Parts extracted side by side, the extraction service's default. */
const EXTRACTION_CHUNK_CONCURRENCY = 3;
/** Claim checks in flight at once. Production runs 6 per item; the lab has the
 *  machine to itself and no spend cap to consult between checks. */
const CHECK_CONCURRENCY = 8;
/** The source kind only changes the wording for YouTube transcripts. The post
 *  is a Substack article, so it is checked as one. */
const SOURCE = "substack";

/** A rated claim together with the title of the part it came from. */
type PartClaim = RatedClaim & { part: string };

/** The intermediate results of a run, saved so a later run can reuse them. */
interface RunStages {
  extraction: ExtractionResult & { kind: "claims" };
  extractionCostUsd: number | null;
  rated?: PartClaim[];
  ratingCostUsd?: number | null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const valueOf = (flag: string) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  const label = valueOf("--label");
  if (!label) throw new Error('Give the run a --label saying what changed, for example --label "baseline"');
  const from = valueOf("--from");
  const reuse = valueOf("--reuse") as Stage | undefined;
  if (reuse && reuse !== "extraction" && reuse !== "rating") throw new Error("--reuse takes extraction or rating");
  if (!!from !== !!reuse) throw new Error("--from and --reuse go together");
  const limit = valueOf("--limit");
  return { label, from, reuse, limit: limit === undefined ? Infinity : Number(limit) };
}

/** A run id sorts by time and reads as one: 2026-09-29-1147. */
function newRunId(): string {
  return new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
}

function currentCommit(): string {
  const commit = execSync("git rev-parse --short HEAD").toString().trim();
  const dirty = execSync("git status --porcelain -- src/everything src/pipeline").toString().trim() !== "";
  return dirty ? `${commit} with uncommitted changes` : commit;
}

const stagesPath = (runId: string) => join(STAGES_DIR, `${runId}.json`);

function saveStages(runId: string, stages: RunStages): void {
  mkdirSync(STAGES_DIR, { recursive: true });
  writeFileSync(stagesPath(runId), JSON.stringify(stages));
}

async function runExtraction(content: FetchedContent): Promise<Pick<RunStages, "extraction" | "extractionCostUsd">> {
  // Reader-requested pages skip the gate, and the production run was one.
  const { result, cost } = await withCostTracker(async () => {
    const found = await extractClaims(content, EXTRACTION_CHUNK_CONCURRENCY, false);
    return { result: found, cost: aggregateAndLogCosts() };
  });
  if (result.kind === "not_checkable") throw new Error(`Extraction declined the article: ${result.reason}`);
  return { extraction: result, extractionCostUsd: cost?.cost ?? null };
}

async function runRating(extraction: RunStages["extraction"]): Promise<{ rated: PartClaim[]; ratingCostUsd: number | null }> {
  const { parts, extracted, speculation, duplicates } = freshClaimsPerPart(extraction.parts, []);
  console.log(`${extracted} claims extracted, ${speculation} predictions dropped, ${duplicates} duplicates dropped`);
  // freshClaimsPerPart already removed claims with the same text, so the text
  // is enough to find each rated claim's part again.
  const partOf = new Map(parts.flatMap((part) => part.claims.map((c) => [c.claim, part.title] as const)));
  const rating = await rateParts(extraction.introduction, parts, async (request) => {
    const result = await rateClaims({ ...request, source: SOURCE });
    return { claims: result.claims, research: result.research, webSearches: result.webSearches, costUsd: result.cost.cost };
  });
  console.log(`Rated ${rating.claims.length} claims with ${rating.webSearches} web searches`);
  return { rated: rating.claims.map((c) => ({ ...c, part: partOf.get(c.claim) ?? "" })), ratingCostUsd: rating.costUsd };
}

/** A rated claim in the run file's shape, before anything decided its outcome. */
function unchecked(claim: PartClaim, index: number, runId: string): LabClaim {
  return {
    id: `${runId}-${index}`,
    claim: claim.claim,
    contextQuote: claim.context || null,
    contextParagraph: claim.contextParagraph || null,
    imageUrls: claim.imageUrls,
    judgement: claim.judgement,
    part: claim.part,
    outcome: { type: "unchecked" },
    notes: [],
    notNeeded: [],
    checkCostUsd: null,
  };
}

function skipped(claim: PartClaim, index: number, runId: string): LabClaim {
  const reason = claim.veryConfidentTrue ? "extractor very confident it is true" : `judged ${claim.judgement}`;
  return { ...unchecked(claim, index, runId), outcome: { type: "skipped", reason } };
}

/** Fact-checks one claim. A check that throws is recorded as an error on the
 *  claim, the way the worker records it, and the run carries on. */
async function checkClaim(claim: PartClaim, index: number, runId: string, publishedAt: string | undefined): Promise<LabClaim> {
  const base = unchecked(claim, index, runId);
  try {
    // The post id is built from a fresh uuid, so no local cache keyed by post
    // id can hand this run an earlier run's input.
    const post = buildClaimPost({ claim, source: SOURCE, itemId: crypto.randomUUID(), index, publishedAt });
    const { check, run } = await runClaimCheck(post);
    mkdirSync(join(LOGS_DIR, runId), { recursive: true });
    writeFileSync(join(LOGS_DIR, runId, `${index}.json`), JSON.stringify(run, null, 1));
    const checked = { ...base, checkCostUsd: run.costUsd };
    if (check.kind === "no_note") return { ...checked, outcome: { type: "no_note", reason: check.reason ?? check.outcome } };
    return {
      ...checked,
      outcome: { type: "note" },
      notes: [
        {
          id: `${base.id}-note`,
          text: check.note,
          author: null,
          isAi: true,
          sources: check.sources,
          votes: { helpful: 0, somewhatHelpful: 0, notHelpful: 0 },
          status: "published",
          createdAt: new Date().toISOString(),
          improvedFromNoteId: null,
        },
      ],
    };
  } catch (err: any) {
    return { ...base, outcome: { type: "error", error: err?.message ?? String(err) } };
  }
}

async function runChecks(rated: PartClaim[], runId: string, publishedAt: string | undefined, limit: number): Promise<LabClaim[]> {
  const toCheck = rated.filter((c) => shouldFactCheck(c.judgement)).slice(0, limit);
  console.log(`Checking ${toCheck.length} of ${rated.length} claims`);
  const queue = new PQueue({ concurrency: CHECK_CONCURRENCY });
  let done = 0;
  return Promise.all(
    rated.map((claim, index) => {
      if (!toCheck.includes(claim)) return skipped(claim, index, runId);
      return queue.add(async () => {
        const result = await checkClaim(claim, index, runId, publishedAt);
        done++;
        console.log(`[${done}/${toCheck.length}] ${result.outcome.type}: ${claim.claim.slice(0, 100)}`);
        return result;
      }) as Promise<LabClaim>;
    }),
  );
}

async function main() {
  // The local OPENROUTER_API_KEY is dead. The testing key works, and the
  // pipeline reads the key only when it makes its first call.
  if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  const { label, from, reuse, limit } = parseArgs();
  const runId = newRunId();
  const commit = currentCommit();
  const article = readArticle();
  const content: FetchedContent = {
    kind: "substack",
    url: article.url,
    title: article.title,
    publishedAt: article.publishedAt ?? undefined,
    text: article.text,
    authorName: article.author ?? undefined,
  };
  const earlier: RunStages | null = from ? JSON.parse(readFileSync(stagesPath(from), "utf8")) : null;
  console.log(`Run ${runId} "${label}"${from ? `, reusing the ${reuse} of ${from}` : ""}`);

  const extracted = earlier ? { extraction: earlier.extraction, extractionCostUsd: null } : await runExtraction(content);
  saveStages(runId, extracted);
  if (reuse === "rating" && !earlier?.rated) throw new Error(`Run ${from} has no saved rating to reuse`);
  const rating = reuse === "rating" ? { rated: earlier!.rated!, ratingCostUsd: null } : await runRating(extracted.extraction);
  saveStages(runId, { ...extracted, ...rating });

  const claims = await runChecks(rating.rated, runId, content.publishedAt, limit);
  const checkCosts = claims.map((c) => c.checkCostUsd).filter((cost): cost is number => cost !== null);
  const run: LabRun = {
    id: runId,
    label,
    createdAt: new Date().toISOString(),
    source: "local",
    commit,
    basedOn: from && reuse ? { runId: from, reused: reuse === "rating" ? ["extraction", "rating"] : ["extraction"] } : null,
    costUsd: {
      extraction: extracted.extractionCostUsd,
      rating: rating.ratingCostUsd,
      checks: checkCosts.reduce((a, b) => a + b, 0),
    },
    claims,
  };
  saveRun(run);
  const notes = claims.filter((c) => c.outcome.type === "note").length;
  const errors = claims.filter((c) => c.outcome.type === "error").length;
  console.log(`\nRun ${runId}: ${claims.length} claims, ${notes} notes, ${errors} errors, $${(run.costUsd.extraction ?? 0) + (run.costUsd.rating ?? 0) + run.costUsd.checks!}`);
}

try {
  await main();
} finally {
  await closeBrowser();
}
