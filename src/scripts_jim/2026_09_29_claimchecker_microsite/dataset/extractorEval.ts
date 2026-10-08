/**
 * Eval 1: is the right claim in the extractor's output?
 *
 * Each datapoint sits in one chunk of its post. The chunk is cut the way the
 * pipeline cuts an unsplit post, with the frozen image descriptions spliced in.
 * The extractor reads each chunk several times, because the same call can find
 * different claims each time. A Muse judge then says, per row and per sample,
 * whether the output contains the reference claim. Rows that share a chunk
 * share its extraction calls.
 */
import PQueue from "p-queue";
import { articleChunk, chunkText, renderImageDescriptions, runExtraction } from "../../../everything/pipeline/extractClaims";
import type { GeminiMediaDescription } from "../../../pipeline/media/mediaAnalysisGemini";
import type { ChunkRun, ChunkSample, DatasetRow, ExtractorEvalResult, ExtractorRowResult, JudgeAnswer } from "./evalTypes";
import { judgeExtraction, withCost } from "./judges";
import { locate } from "./text";

const SAMPLES_PER_CHUNK = 3;
/** A row passes when the extractor's output contained its claim in at least this many samples. */
const PASS_AT = 2;
const EXTRACTION_CONCURRENCY = 4;
const JUDGE_CONCURRENCY = 6;

interface RowChunk {
  key: string;
  chunk: string;
  chunkIndex: number;
  chunkCount: number;
  passage: string;
}

/** The chunk of the row's post that holds its passage, cut after the image descriptions went in. */
function chunkOf(row: DatasetRow, text: string, descriptions: Map<string, GeminiMediaDescription>): RowChunk {
  const chunks = chunkText(renderImageDescriptions(text, descriptions));
  const quote = row.checker.claim.contextQuote;
  const imageUrl = row.checker.claim.imageUrls[0];
  const index = chunks.findIndex((chunk) => (quote ? !!locate(chunk, quote) : chunk.includes(`Image: ${imageUrl}`)));
  if (index === -1) throw new Error(`No chunk holds the passage of ${row.id}`);
  const chunk = chunks[index]!;
  // An image claim has no passage, so the judge is shown the image's description block.
  const passage = quote ?? chunk.slice(chunk.lastIndexOf("[Image:", chunk.indexOf(`Image: ${imageUrl}`) + 1), chunk.indexOf("]", chunk.indexOf(`Image: ${imageUrl}`)) + 1);
  return { key: `${row.item.id}#${index + 1}`, chunk: articleChunk(chunk), chunkIndex: index + 1, chunkCount: chunks.length, passage };
}

async function sampleChunk(userMessage: string): Promise<ChunkSample> {
  try {
    const { value, costUsd } = await withCost(() => runExtraction(userMessage));
    return { claims: value.map((c) => ({ claim: c.claim, context: c.context, imageUrls: c.imageUrls })), costUsd };
  } catch (err: any) {
    return { claims: [], speculationDropped: 0, costUsd: 0, error: err?.message ?? String(err) };
  }
}

export async function runExtractorEval(
  rows: DatasetRow[],
  texts: Map<string, string>,
  descriptions: Map<string, GeminiMediaDescription>,
): Promise<ExtractorEvalResult> {
  const rowChunks = new Map(rows.map((row) => [row.id, chunkOf(row, texts.get(row.item.id)!, descriptions)]));
  const distinct = new Map([...rowChunks.values()].map((c) => [c.key, c]));
  console.log(`Extractor eval: ${rows.length} rows in ${distinct.size} chunks, ${SAMPLES_PER_CHUNK} samples each`);

  const extractionQueue = new PQueue({ concurrency: EXTRACTION_CONCURRENCY });
  const titleOf = new Map(rows.map((r) => [`${r.item.id}`, r.item.title]));
  const chunkRuns: ChunkRun[] = await Promise.all(
    [...distinct.values()].map(async (c) => {
      const samples = await Promise.all(
        Array.from({ length: SAMPLES_PER_CHUNK }, () => extractionQueue.add(() => sampleChunk(c.chunk)) as Promise<ChunkSample>),
      );
      console.log(`  ${c.key}: ${samples.map((s) => (s.error ? "error" : s.claims.length)).join(", ")} claims`);
      return { key: c.key, itemTitle: titleOf.get(c.key.split("#")[0]!) ?? "", chunkIndex: c.chunkIndex, chunkCount: c.chunkCount, chunkChars: c.chunk.length, samples };
    }),
  );

  const judgeQueue = new PQueue({ concurrency: JUDGE_CONCURRENCY });
  let judgeCostUsd = 0;
  const rowResults: ExtractorRowResult[] = await Promise.all(
    rows.map(async (row) => {
      const { key, passage } = rowChunks.get(row.id)!;
      const run = chunkRuns.find((r) => r.key === key)!;
      const judgements: (JudgeAnswer | null)[] = await Promise.all(
        run.samples.map((sample) =>
          sample.error
            ? null
            : (judgeQueue.add(async () => {
                const { answer, costUsd } = await judgeExtraction(row.referenceClaim, passage, sample.claims.map((c) => c.claim));
                judgeCostUsd += costUsd;
                return answer;
              }) as Promise<JudgeAnswer>),
        ),
      );
      const foundIn = judgements.filter((j) => j?.found).length;
      console.log(`  ${row.id}: found in ${foundIn} of ${SAMPLES_PER_CHUNK}`);
      return { id: row.id, group: row.group, referenceClaim: row.referenceClaim, passage, chunkKey: key, judgements, foundIn, passed: foundIn >= PASS_AT };
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
