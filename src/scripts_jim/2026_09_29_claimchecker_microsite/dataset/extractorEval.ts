/**
 * Eval 1: is the right claim in the extractor's output?
 *
 * Each datapoint sits in one chunk of its post. The chunk is saved in the
 * dataset exactly as the extractor reads it, with the frozen image
 * descriptions spliced in. The extractor reads each chunk several times,
 * because the same call can find different claims each time. A Muse judge then
 * says, for each statement the datapoint must produce and for each sample,
 * whether the output contains it. Statements of one datapoint, and datapoints
 * in one chunk, share the chunk's extraction calls.
 */
import PQueue from "p-queue";
import { runExtraction } from "../../../everything/pipeline/extractClaims";
import type { ChunkRun, ChunkSample, DatasetRow, ExtractorEvalResult, ExtractorRowResult, JudgeAnswer } from "./evalTypes";
import { judgeExtraction, withCost } from "./judges";

const SAMPLES_PER_CHUNK = 3;
/** A row passes when the extractor's output contained its claim in at least this many samples. */
const PASS_AT = 2;
const EXTRACTION_CONCURRENCY = 4;
const JUDGE_CONCURRENCY = 6;

/** One statement to find, in the chunk of its datapoint. */
interface EvalCase {
  id: string;
  datapointId: string;
  group: DatasetRow["group"];
  referenceClaim: string;
  chunkKey: string;
  /** The text of the passage the statement is in, which the judge is shown. */
  passage: string;
}

function casesOf(rows: DatasetRow[]): EvalCase[] {
  return rows.flatMap((row) => {
    const { highlight, userMessage } = row.extractor;
    const passage = highlight ? userMessage.slice(highlight.start, highlight.end) : "";
    return row.referenceClaims.map((referenceClaim, i) => ({
      id: row.referenceClaims.length > 1 ? `${row.id}#${i + 1}` : row.id,
      datapointId: row.id,
      group: row.group,
      referenceClaim,
      chunkKey: `${row.item.id}#${row.extractor.chunkIndex}`,
      passage,
    }));
  });
}

async function sampleChunk(userMessage: string): Promise<ChunkSample> {
  try {
    const { value, costUsd } = await withCost(() => runExtraction(userMessage));
    return { claims: value.map((c) => ({ claim: c.claim, context: c.context, imageUrls: c.imageUrls })), costUsd };
  } catch (err: any) {
    return { claims: [], costUsd: 0, error: err?.message ?? String(err) };
  }
}

export async function runExtractorEval(rows: DatasetRow[]): Promise<ExtractorEvalResult> {
  const cases = casesOf(rows);
  const chunks = new Map(rows.map((row) => [`${row.item.id}#${row.extractor.chunkIndex}`, { row, message: row.extractor.userMessage }]));
  console.log(`Extractor eval: ${cases.length} statements of ${rows.length} datapoints in ${chunks.size} chunks, ${SAMPLES_PER_CHUNK} samples each`);

  const extractionQueue = new PQueue({ concurrency: EXTRACTION_CONCURRENCY });
  const chunkRuns: ChunkRun[] = await Promise.all(
    [...chunks].map(async ([key, { row, message }]) => {
      const samples = await Promise.all(Array.from({ length: SAMPLES_PER_CHUNK }, () => extractionQueue.add(() => sampleChunk(message)) as Promise<ChunkSample>));
      console.log(`  ${key}: ${samples.map((s) => (s.error ? "error" : s.claims.length)).join(", ")} claims`);
      return { key, itemTitle: row.item.title, chunkIndex: row.extractor.chunkIndex, chunkCount: row.extractor.chunkCount, chunkChars: message.length, samples };
    }),
  );

  const judgeQueue = new PQueue({ concurrency: JUDGE_CONCURRENCY });
  let judgeCostUsd = 0;
  const rowResults: ExtractorRowResult[] = await Promise.all(
    cases.map(async (c) => {
      const run = chunkRuns.find((r) => r.key === c.chunkKey)!;
      const judgements: (JudgeAnswer | null)[] = await Promise.all(
        run.samples.map((sample) =>
          sample.error
            ? null
            : (judgeQueue.add(async () => {
                const { answer, costUsd } = await judgeExtraction(c.referenceClaim, c.passage, sample.claims.map((x) => x.claim));
                judgeCostUsd += costUsd;
                return answer;
              }) as Promise<JudgeAnswer>),
        ),
      );
      const foundIn = judgements.filter((j) => j?.found).length;
      console.log(`  ${c.id}: found in ${foundIn} of ${SAMPLES_PER_CHUNK}`);
      return { id: c.id, datapointId: c.datapointId, group: c.group, referenceClaim: c.referenceClaim, passage: c.passage, chunkKey: c.chunkKey, judgements, foundIn, passed: foundIn >= PASS_AT };
    }),
  );
  return {
    samples: SAMPLES_PER_CHUNK,
    passAt: PASS_AT,
    rows: rowResults,
    chunkRuns,
    costUsd: { extraction: chunkRuns.flatMap((r) => r.samples).reduce((sum, s) => sum + s.costUsd, 0), judge: judgeCostUsd },
  };
}
