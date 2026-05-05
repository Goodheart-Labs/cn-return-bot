/**
 * Smoke test the note_rating_tag_counts upsert path against local Supabase.
 *
 * Synthesizes one `WrittenNote` with all three factor buckets populated
 * (helpful + not-helpful tag in each), runs the upsert path, asserts the
 * expected 6 rows landed, then cleans up.
 *
 * Local creds give us `has_access=false` everywhere, so this is the only
 * way to exercise the upsert before the prod notewriter qualifies for
 * scoring access.
 *
 * Usage:
 *   bun run src/scripts_jim/2026_05_05_rating_endpoint/smoke_test_rating_tags.ts
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.LOCAL_SUPABASE_URL;
const key = process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("requires LOCAL_SUPABASE_URL / LOCAL_SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const client = createClient(url, key);

const NOTE_ID = `smoke_rating_${Date.now()}`;
const TWEET_ID = `smoke_tweet_${Date.now()}`;
const MODEL = "smoke_model";

type RaterBucket = "negative" | "neutral" | "positive";

const fakeNote = {
  id: NOTE_ID,
  post_id: TWEET_ID,
  status: "needs_more_ratings",
  info: { text: "smoke test", classification: "x", misleading_tags: [], trustworthy_sources: false },
  scoring_status: {
    has_access: true,
    rating_counts_per_model: {
      [MODEL]: {
        negative_factor_bucket_counts: {
          helpful_tag_counts: { tag_name: "helpfulClear", tag_count: 7 },
          not_helpful_tag_counts: { tag_name: "notHelpfulOpinionSpeculationOrBias", tag_count: 3 },
        },
        neutral_factor_bucket_counts: {
          helpful_tag_counts: { tag_name: "helpfulAddressesClaim", tag_count: 5 },
          not_helpful_tag_counts: { tag_name: "notHelpfulMissingKeyPoints", tag_count: 2 },
        },
        positive_factor_bucket_counts: {
          helpful_tag_counts: { tag_name: "helpfulGoodSources", tag_count: 9 },
          not_helpful_tag_counts: { tag_name: "notHelpfulIncorrect", tag_count: 1 },
        },
      },
    },
  },
};

type RatingTagRow = {
  note_id: string;
  model_name: string;
  tag_name: string;
  count: number;
  rater_bucket: RaterBucket;
  last_updated_at: string;
};

function buildTagRow(
  noteId: string,
  modelName: string,
  bucket: RaterBucket,
  tag: { tag_name: string; tag_count: number } | undefined,
  now: string,
): RatingTagRow | null {
  if (!tag?.tag_name || typeof tag.tag_count !== "number") return null;
  return {
    note_id: noteId,
    model_name: modelName,
    tag_name: tag.tag_name,
    count: tag.tag_count,
    rater_bucket: bucket,
    last_updated_at: now,
  };
}

async function main() {
  console.log(`[smoke] note_id=${NOTE_ID}`);

  // 1. Insert a fake `notes` row (FK requirement).
  const now = new Date().toISOString();
  const { error: noteErr } = await client.from("notes").insert({
    note_id: NOTE_ID,
    tweet_id: TWEET_ID,
    cn_status: "NEEDS_MORE_RATINGS",
    note_text: "smoke",
    first_seen_at: now,
  });
  if (noteErr) throw new Error(`insert notes: ${noteErr.message}`);

  try {
    // 2. Run the same row-construction logic as updateNoteFeedback Stage I.
    const rows: RatingTagRow[] = [];
    const ss = fakeNote.scoring_status;
    const perModel = ss.rating_counts_per_model;
    for (const [modelName, modelData] of Object.entries(perModel)) {
      const bucketsByName: Array<[RaterBucket, any]> = [
        ["negative", modelData?.negative_factor_bucket_counts],
        ["neutral", modelData?.neutral_factor_bucket_counts],
        ["positive", modelData?.positive_factor_bucket_counts],
      ];
      for (const [bucket, counts] of bucketsByName) {
        if (!counts) continue;
        const helpful = buildTagRow(fakeNote.id, modelName, bucket, counts.helpful_tag_counts, now);
        const notHelpful = buildTagRow(fakeNote.id, modelName, bucket, counts.not_helpful_tag_counts, now);
        if (helpful) rows.push(helpful);
        if (notHelpful) rows.push(notHelpful);
      }
    }
    console.log(`[smoke] built ${rows.length} rows (expected 6)`);
    if (rows.length !== 6) throw new Error(`expected 6 rows, got ${rows.length}`);

    // 3. Upsert.
    const { error: upErr } = await client
      .from("note_rating_tag_counts")
      .upsert(rows, { onConflict: "note_id,model_name,tag_name,rater_bucket" });
    if (upErr) throw new Error(`upsert rating-tags: ${upErr.message}`);
    console.log(`[smoke] upsert OK`);

    // 4. Read back; confirm count + bucket distribution.
    const { data: read, error: readErr } = await client
      .from("note_rating_tag_counts")
      .select("rater_bucket, tag_name, count")
      .eq("note_id", NOTE_ID);
    if (readErr) throw new Error(`select: ${readErr.message}`);
    if (!read || read.length !== 6) throw new Error(`expected 6 rows in DB, got ${read?.length}`);
    const buckets = new Set(read.map((r) => r.rater_bucket));
    if (buckets.size !== 3) throw new Error(`expected 3 distinct buckets, got ${buckets.size}`);
    console.log(`[smoke] read-back OK: ${read.length} rows across ${buckets.size} buckets`);

    // 5. Re-upsert and confirm idempotence (still 6 rows, no duplicates).
    const { error: reErr } = await client
      .from("note_rating_tag_counts")
      .upsert(rows, { onConflict: "note_id,model_name,tag_name,rater_bucket" });
    if (reErr) throw new Error(`re-upsert: ${reErr.message}`);
    const { count } = await client
      .from("note_rating_tag_counts")
      .select("*", { count: "exact", head: true })
      .eq("note_id", NOTE_ID);
    if (count !== 6) throw new Error(`expected 6 after re-upsert, got ${count}`);
    console.log(`[smoke] idempotent OK`);
  } finally {
    // 6. Cleanup: deleting notes cascades to note_rating_tag_counts via FK.
    await client.from("notes").delete().eq("note_id", NOTE_ID);
    console.log(`[smoke] cleaned up`);
  }

  console.log(`[smoke] PASS`);
}

main().catch((err) => {
  console.error(`[smoke] FAIL: ${err.message || err}`);
  process.exit(1);
});
