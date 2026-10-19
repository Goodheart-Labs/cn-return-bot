/**
 * Runs the claim extractor on personal memoir posts (GOO-433) and saves what it
 * puts into statements and what it puts into "other", for reading by hand. The
 * posts have no labels. One sample per chunk.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/memoirExtraction.ts
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { join } from "path";
import PQueue from "p-queue";
import { articleChunk, chunkText, renderImageDescriptions, runPassageExtraction } from "../../../everything/pipeline/extractClaims";
import { LAB_DIR } from "../runStore";

/** The memoir posts of the ticket: six of jamesguilty.substack.com and one of aella.substack.com. */
export const MEMOIR_ITEM_IDS = [
  "d635f9c2-3c56-4f01-b5e8-7e365fc7f5ae", // Why I Left New York
  "c2e02ae0-dcb3-4b86-b0e7-f5e6e1de722b", // Dating 8 Girls at Once in New York City
  "4f86439d-0d9b-4087-91cb-24a1bf7ade05", // The Succubus Bitch Who Drained Me
  "8f3c30b2-74c5-4b55-9030-48ec836f572d", // Exploiting My OnlyFans Girlfriend
  "8137efa3-4e37-4ad8-bccd-5bba157e9df8", // Scamming My Audience for $30,000
  "02c51e42-04bf-44ff-973a-ef809c877358", // My Japanese Sugar Mama
  "7267336f-015d-46af-9d8c-b28379b54873", // My Year On A Factory Floor Assembly Line
];

const CONCURRENCY = 6;

async function main() {
  if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const { data: items, error } = await db.from("everything_items").select("id, title, url, full_text").in("id", MEMOIR_ITEM_IDS);
  if (error) throw error;
  const queue = new PQueue({ concurrency: CONCURRENCY });
  const posts = await Promise.all(
    MEMOIR_ITEM_IDS.map(async (id) => {
      const item = items.find((i) => i.id === id)!;
      const { count } = await db.from("everything_claims").select("id", { count: "exact", head: true }).eq("item_id", id);
      const chunks = chunkText(renderImageDescriptions(item.full_text ?? "", new Map()));
      const results = await Promise.all(
        chunks.map((chunk, index) =>
          queue.add(async () => {
            try {
              const { passages } = await runPassageExtraction(articleChunk(chunk));
              return { chunkIndex: index + 1, error: null, passages: passages.map((p) => ({ text: p.text, type: p.type, why: typeof p.extra.why === "string" ? p.extra.why : null, claims: p.claims })) };
            } catch (err: any) {
              // One chunk that the model cannot answer in valid JSON must not lose the others. The error is saved with the chunk.
              return { chunkIndex: index + 1, error: err?.message ?? String(err), passages: [] };
            }
          }),
        ),
      );
      console.log(`${item.title}: ${chunks.length} chunks done`);
      return { id, title: item.title, url: item.url, textChars: (item.full_text ?? "").length, productionClaims: count, chunks: results };
    }),
  );
  writeFileSync(join(LAB_DIR, "dataset", "memoirExtraction.json"), JSON.stringify({ ranAt: new Date().toISOString(), posts }, null, 1));
  console.log("Saved memoirExtraction.json");
}

await main();
