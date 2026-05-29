/**
 * For each pilot row, build the production user message (what DeepSeek sees)
 * and save it to disk so subagents can read it without any hindsight contamination.
 *
 * Output:
 *   user_messages/<tweet_id>.txt   — exactly what production query writer sees
 *   pilot_meta.json                — minimal metadata (no reference info)
 */

import * as fs from "fs";
import * as path from "path";
import { buildUserMessageForCandidate, type Candidate } from "../2026_05_27_query_writer_eval/evalHarness";

const PILOT_PATH = "src/scripts_jim/2026_05_27_gold_queries/pilot_rows.jsonl";
const OUT_DIR = "src/scripts_jim/2026_05_27_gold_queries/user_messages";

fs.mkdirSync(OUT_DIR, { recursive: true });

const rows: Candidate[] = fs
  .readFileSync(PILOT_PATH, "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

const meta: Array<{
  tweet_id: string;
  primary_category: string;
  user_message_chars: number;
  user_message_file: string;
}> = [];

for (const c of rows) {
  try {
    const msg = buildUserMessageForCandidate(c);
    const file = path.join(OUT_DIR, `${c.tweet_id}.txt`);
    fs.writeFileSync(file, msg);
    meta.push({
      tweet_id: c.tweet_id,
      primary_category: c.primary_category,
      user_message_chars: msg.length,
      user_message_file: file,
    });
    console.log(`${c.tweet_id}  ${msg.length.toString().padStart(6)} chars  ${c.primary_category}`);
  } catch (e: any) {
    console.log(`${c.tweet_id}  FAILED: ${e?.message ?? e}`);
  }
}

fs.writeFileSync(
  "src/scripts_jim/2026_05_27_gold_queries/pilot_meta.json",
  JSON.stringify(meta, null, 2)
);
console.log(`\nWrote ${meta.length} user messages.`);
