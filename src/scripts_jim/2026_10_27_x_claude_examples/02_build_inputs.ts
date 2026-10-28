/**
 * Step 2 of the X Claude examples (GOO-527, GOO-614): fetch each candidate's
 * tweet from X and render the input Claude would have seen for it.
 *
 * Candidates are walked in the order step 1 drew them. A tweet that X no
 * longer serves is skipped, and the next candidate takes its place, until 50
 * helpful and 50 not-helpful examples are built. The input is rendered as of
 * the moment the note was written, with the image descriptions and without
 * author history (Jim, 2026-10-27).
 *
 *   bun run src/scripts_jim/2026_10_27_x_claude_examples/02_build_inputs.ts
 */

import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import * as path from "path";
import PQueue from "p-queue";
import { fetchTweetById, TweetLookupError } from "../../api/fetchTweetById";
import { buildClaudeTweetInput } from "../../pipeline/input/claudeTweetInput";

const HERE = import.meta.dir;
const EXAMPLES_PER_VERDICT = 50;
const CONCURRENCY = 5;

interface Candidate {
  note_id: string;
  tweet_id: string;
  created_at_ms: number;
  text: string;
  status: string;
  not_needed_notes: { text: string; status: string; created_at_ms: number }[];
}

type Built = Candidate & { input: string };

async function build(candidate: Candidate): Promise<Built | null> {
  try {
    const post = await fetchTweetById(candidate.tweet_id);
    const input = await buildClaudeTweetInput(post, { describeImages: true, authorHistory: false, now: new Date(candidate.created_at_ms) });
    return { ...candidate, input };
  } catch (err) {
    // X answers a deleted or protected tweet with no data. Every other error,
    // such as a dead key, must stop the build rather than skip every tweet.
    if (err instanceof TweetLookupError && err.kind === "unavailable") {
      console.log(`skip ${candidate.tweet_id}: ${err.message.slice(0, 160)}`);
      return null;
    }
    throw err;
  }
}

/** Builds candidates in their drawn order until `count` succeed. */
async function buildFirst(candidates: Candidate[], count: number): Promise<Built[]> {
  const built: (Built | null | undefined)[] = new Array(candidates.length);
  const queue = new PQueue({ concurrency: CONCURRENCY });
  const succeededBefore = (index: number) => built.slice(0, index).filter(Boolean).length;
  candidates.forEach((candidate, index) =>
    queue.add(async () => {
      if (succeededBefore(index) >= count) return;
      built[index] = await build(candidate);
      console.log(`${candidate.status} ${index + 1}/${candidates.length}: ${built[index] ? "built" : "skipped"}`);
    }),
  );
  await queue.onIdle();
  const kept = built.filter((b): b is Built => !!b).slice(0, count);
  if (kept.length < count) throw new Error(`Only ${kept.length} of ${count} ${candidates[0]?.status} examples could be built`);
  return kept;
}

const candidates: Candidate[] = readFileSync(path.join(HERE, "candidates.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const verdicts = [...new Set(candidates.map((c) => c.status))];
const examples: Built[] = [];
for (const verdict of verdicts) examples.push(...(await buildFirst(candidates.filter((c) => c.status === verdict), EXAMPLES_PER_VERDICT)));
writeFileSync(path.join(HERE, "examples.jsonl"), examples.map((e) => JSON.stringify(e)).join("\n") + "\n");
console.log(`Wrote ${examples.length} examples`);
