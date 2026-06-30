/**
 * Smoke test for the author_history A/B test + the (now-fixed) author-history
 * feature. Run from workspace root: `bun run src/scripts_jim/2026_06_29_author_history_ab/smoke.ts`
 *
 * Verifies, end to end:
 *   A. AUTHOR_HISTORY_TEST splits ~50/50 and sets config.author_history.
 *   B. Forced picks resolve the flag (on→true, off→false).
 *   C. getAuthorNoteHistory returns real helpful history for a known author.
 *   D. buildUserMessage injects the history block only when present.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import { AB_TESTS } from "../../pipeline/ab-testing/abTestsData";
import { runABTests, withForcedPicks } from "../../pipeline/ab-testing/abTests";
import { getAuthorNoteHistory } from "../../pipeline/input/authorHistory";
import { buildUserMessage } from "../../pipeline/prompts/input/userMessage";

// HoopsCrave — author with 6 of our CURRENTLY_RATED_HELPFUL notes (found via prod).
const DEMO_AUTHOR_ID = "1986852813071392769";
const N = 4000;

function assert(ok: boolean, msg: string) {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${msg}`);
  if (!ok) process.exitCode = 1;
}

// A. Split + flag wiring
const counts: Record<string, number> = { on: 0, off: 0 };
let flagMatchesPick = true;
for (let i = 0; i < N; i++) {
  const { config, picks } = runABTests(AB_TESTS);
  const pick = picks["author_history"]!;
  counts[pick] = (counts[pick] ?? 0) + 1;
  const expected = pick === "on";
  if ((config.author_history ?? false) !== expected) flagMatchesPick = false;
}
const onPct = (counts.on / N) * 100;
console.log(`\nA. split over ${N}: on=${counts.on} (${onPct.toFixed(1)}%) off=${counts.off}`);
assert(onPct > 45 && onPct < 55, `~50/50 split (got ${onPct.toFixed(1)}% on)`);
assert(flagMatchesPick, "config.author_history matches the recorded pick every run");

// B. Forced picks
const onCfg = withForcedPicks({ author_history: "on" }, () => runABTests(AB_TESTS).config);
const offCfg = withForcedPicks({ author_history: "off" }, () => runABTests(AB_TESTS).config);
console.log(`\nB. forced on→${onCfg.author_history}  off→${offCfg.author_history}`);
assert(onCfg.author_history === true, "forced 'on' → author_history true");
assert(offCfg.author_history === false, "forced 'off' → author_history false");

// C. Live feature data
const history = await getAuthorNoteHistory(DEMO_AUTHOR_ID);
console.log(`\nC. getAuthorNoteHistory(${DEMO_AUTHOR_ID}): totalHelpful=${history.totalHelpful}, injected=${history.helpfulNotes.length}`);
for (const n of history.helpfulNotes) {
  console.log(`   post:  ${n.tweetText.slice(0, 70)}`);
  console.log(`   note:  ${n.noteText.slice(0, 90)}`);
}
assert(history.totalHelpful > 0, "feature returns >0 helpful notes for the demo author");

// D. Prompt injection (on-arm includes the block; off-arm omits it)
const post = {
  id: "0",
  created_at: "2026-06-29T00:00:00.000Z",
  text: "demo post text",
  author_id: DEMO_AUTHOR_ID,
  author_name: "HoopsCrave",
} as unknown as Post;

const onMsg = buildUserMessage({ post, tweetMedia: [], quotedTweetMedia: [], authorNoteHistory: history });
const offMsg = buildUserMessage({ post, tweetMedia: [], quotedTweetMedia: [], authorNoteHistory: undefined });
const marker = "Past corrections to this author's posts";
console.log(`\nD. user message: on-arm includes block=${onMsg.includes(marker)}, off-arm includes block=${offMsg.includes(marker)}`);
assert(onMsg.includes(marker), "on-arm user message contains the author-history block");
assert(!offMsg.includes(marker), "off-arm user message omits the author-history block");

console.log(`\n--- on-arm block preview ---`);
console.log(onMsg.slice(onMsg.indexOf("## " + marker), onMsg.indexOf("## " + marker) + 500));
