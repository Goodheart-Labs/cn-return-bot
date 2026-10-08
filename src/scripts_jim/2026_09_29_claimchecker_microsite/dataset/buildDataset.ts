/**
 * Builds dataset.json from datapoints.ts, read-only. For every datapoint it
 * takes from production the full text of the post, cuts it into the chunks the
 * extractor reads, and finds the chunk that holds the passage. It also builds
 * the post the claim checker is handed, with the pipeline's own function, and
 * collects what production did with the claim. It calls no model and writes
 * nothing to the database.
 *
 * The images of the posts are shown by the descriptions that freezeImages.ts
 * saved, spliced in before the text is cut, which is what the extractor reads.
 * Run freezeImages.ts first.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/buildDataset.ts
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { buildClaimPost } from "../../../everything/pipeline/checkClaims";
import { articleChunk, chunkText, renderImageDescriptions } from "../../../everything/pipeline/extractClaims";
import type { ExtractedClaim } from "../../../everything/types";
import { checkTraceOf, type LabRun } from "../labRun";
import { LAB_DIR, RUNS_DIR } from "../runStore";
import { DATAPOINTS, GROUP_TITLE, type Datapoint } from "./datapoints";
import { loadFrozenDescriptions } from "./freezeImages";
import { locate, paragraphsAround } from "./text";

const DATASET_PATH = join(LAB_DIR, "dataset", "dataset.json");
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

/** The claim as the checker needs it, from wherever the claim lives. */
interface SourceClaim {
  id: string;
  restatement: string;
  contextQuote: string | null;
  contextParagraph: string | null;
  imageUrls: string[];
}

async function claimOf(datapoint: Datapoint): Promise<SourceClaim> {
  const source = datapoint.claimSource;
  if (source.from === "lab") {
    const run: LabRun = JSON.parse(readFileSync(join(RUNS_DIR, `${source.runId}.json`), "utf8"));
    const claim = run.claims.find((c) => c.id === source.claimId);
    if (!claim) throw new Error(`Claim ${source.claimId} is not in run ${source.runId}`);
    return { id: claim.id, restatement: claim.claim, contextQuote: claim.contextQuote, contextParagraph: claim.contextParagraph, imageUrls: claim.imageUrls };
  }
  const { data, error } = await db
    .from("everything_claims")
    .select("id, claim, context_quote, context_paragraph, image_urls")
    .eq("id", source.claimId)
    .single();
  if (error) throw error;
  return { id: data.id, restatement: data.claim, contextQuote: data.context_quote, contextParagraph: data.context_paragraph, imageUrls: (data.image_urls as string[] | null) ?? [] };
}

/** The chunk the extractor would read the passage in, shown as the user message
 *  it would get. An image claim has no passage, so its chunk is the one that
 *  holds the image. */
function extractorInput(text: string, claim: SourceClaim, descriptions: ReturnType<typeof loadFrozenDescriptions>) {
  const chunks = chunkText(renderImageDescriptions(text, descriptions));
  const imageMarker = claim.contextQuote ? null : `Image: ${claim.imageUrls[0]}`;
  const index = chunks.findIndex((chunk) => (imageMarker ? chunk.includes(imageMarker) : !!locate(chunk, claim.contextQuote!)));
  if (index === -1) throw new Error(`No chunk holds the passage of claim ${claim.id}`);
  const userMessage = articleChunk(chunks[index]!);
  const span = imageMarker
    ? (() => {
        const at = userMessage.indexOf(imageMarker);
        return { start: userMessage.lastIndexOf("[Image:", at + 1), end: userMessage.indexOf("]", at) + 1 };
      })()
    : locate(userMessage, claim.contextQuote!);
  return {
    userMessage,
    chunkIndex: index + 1,
    chunkCount: chunks.length,
    chunkChars: chunks[index]!.length,
    highlight: span,
    imageBlocksInChunk: (userMessage.match(/\[Image: /g) ?? []).length,
  };
}

/** What the logs of the production check saved of its first search prompt. */
function searchPromptOf(messages: unknown): string | null {
  const first = Array.isArray(messages) ? messages[0] : (messages as Record<string, unknown> | null)?.["0"];
  return (first as { userMessage?: string } | undefined)?.userMessage ?? null;
}

async function productionOutcome(claimId: string) {
  const { data: claim, error } = await db.from("everything_claims").select("status, status_reason, judgement").eq("id", claimId).single();
  if (error) throw error;
  const { data: notes, error: notesError } = await db
    .from("everything_notes")
    .select("note, author_id, author_name, status, helpful_count, somewhat_helpful_count, not_helpful_count, everything_note_sources(url, quote, explanation, sort_order)")
    .eq("claim_id", claimId);
  if (notesError) throw notesError;
  const { data: runs, error: runsError } = await db
    .from("everything_pipeline_runs")
    .select(
      "cost, searchMessages:logs->note_writer_steps->search->messages, writerAttempts:logs->note_writer_steps->note_writer->attempts, sourceCheck:logs->sourceCheck",
    )
    .eq("claim_id", claimId)
    .returns<{ cost: number | null; searchMessages: unknown; writerAttempts: unknown; sourceCheck: unknown }[]>();
  if (runsError) throw runsError;
  const run = runs[0];
  return {
    status: claim.status,
    reason: claim.status_reason,
    judgement: claim.judgement,
    notes: notes.map((n) => ({
      text: n.note,
      writtenBy: n.author_id ? `reader ${n.author_name ?? "anonymous"}` : "the pipeline",
      votes: { helpful: n.helpful_count, somewhatHelpful: n.somewhat_helpful_count, notHelpful: n.not_helpful_count },
      sources: [...n.everything_note_sources].sort((a, b) => a.sort_order - b.sort_order).map(({ url, quote, explanation }) => ({ url, quote, explanation })),
    })),
    checkCostUsd: run ? Number(run.cost ?? 0) : null,
    checkPromptAsReceived: run ? searchPromptOf(run.searchMessages) : null,
    trace: run ? checkTraceOf({ note_writer_steps: { search: { messages: run.searchMessages }, note_writer: { attempts: run.writerAttempts } }, sourceCheck: run.sourceCheck }) : null,
  };
}

function labPromptAsReceived(runId: string, claimId: string): string | null {
  const index = claimId.split("-").pop();
  const path = join(LAB_DIR, "logs", runId, `${index}.json`);
  try {
    const log = JSON.parse(readFileSync(path, "utf8"));
    return searchPromptOf(log.logs.note_writer_steps.search.messages);
  } catch {
    return null;
  }
}

async function buildRecord(datapoint: Datapoint, descriptions: ReturnType<typeof loadFrozenDescriptions>) {
  const { data: item, error } = await db.from("everything_items").select("id, title, url, source, published_at, created_at, full_text").eq("id", datapoint.itemId).single();
  if (error) throw error;
  const claim = await claimOf(datapoint);
  const text = item.full_text as string;

  // A passage a reader highlighted has no surrounding paragraph in the
  // database, so it is taken from the text, which is what the extractor would
  // have stored had it found the claim itself.
  const storedParagraph = claim.contextParagraph;
  const paragraph = storedParagraph ?? (claim.contextQuote ? paragraphsAround(text, claim.contextQuote) : null);
  const extractedClaim = {
    claim: claim.restatement,
    context: claim.contextQuote ?? "",
    contextParagraph: paragraph ?? "",
    imageUrls: claim.imageUrls,
  } as ExtractedClaim;
  const post = buildClaimPost({ claim: extractedClaim, source: "substack", itemId: item.id, index: 0, publishedAt: item.published_at ?? item.created_at });

  const productionClaimId = datapoint.claimSource.from === "lab" ? datapoint.claimSource.productionClaimId : datapoint.claimSource.claimId;
  const production = await productionOutcome(productionClaimId);
  const asReceived =
    datapoint.claimSource.from === "lab"
      ? { from: `lab run ${datapoint.claimSource.runId}`, prompt: labPromptAsReceived(datapoint.claimSource.runId, datapoint.claimSource.claimId) }
      : production.checkPromptAsReceived
        ? { from: "production check log", prompt: production.checkPromptAsReceived }
        : null;

  return {
    id: datapoint.id,
    group: datapoint.group,
    groupTitle: GROUP_TITLE[datapoint.group],
    jimsWords: datapoint.jimsWords,
    writtenOn: datapoint.writtenOn,
    expected: datapoint.expected,
    referenceClaim: datapoint.referenceClaim,
    item: { id: item.id, title: item.title, url: item.url, source: item.source, publishedAt: item.published_at, textChars: text.length },
    extractor: extractorInput(text, claim, descriptions),
    checker: {
      claim: { ...claim, paragraphTakenFromText: !storedParagraph && !!paragraph },
      post,
      asReceived,
    },
    production: { claimId: productionClaimId, ...production, checkPromptAsReceived: undefined },
  };
}

const descriptions = loadFrozenDescriptions();
const records = [];
for (const datapoint of DATAPOINTS) {
  const record = await buildRecord(datapoint, descriptions);
  records.push(record);
  console.log(
    `${datapoint.id.padEnd(30)} chunk ${record.extractor.chunkIndex}/${record.extractor.chunkCount} (${record.extractor.chunkChars} chars)`,
    `highlight ${record.extractor.highlight ? "found" : "MISSING"}`,
    `| paragraph ${record.checker.claim.paragraphTakenFromText ? "from text" : record.checker.claim.contextParagraph ? "stored" : "NONE"}`,
    `| as received ${record.checker.asReceived?.prompt ? "yes" : "no"}`,
  );
}
writeFileSync(DATASET_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), datapoints: records }, null, 1));
console.log(`Wrote ${records.length} datapoints to ${DATASET_PATH}`);
