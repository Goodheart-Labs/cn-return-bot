/**
 * This file holds the data half of the A/B test framework. The runtime helpers
 * such as `runABTests`, `withForcedPicks` and `resolvePicks` live in
 * `abTests.ts`, because they need `node:async_hooks`.
 *
 * This file is safe to load in a browser. It only mentions BotConfig through an
 * `import type`. That lets the dashboards import `AB_TESTS` directly and read
 * the order in which the tests and their variants are declared.
 */

import type { BotConfig } from "./botConfig";
import { MISINFO_TOPIC_IDS } from "../misinfo-monitoring/topicIds";

// --- Types ---

/**
 * A prerequisite value is either the exact value the config field must equal, or
 * a list of values any one of which is acceptable. The list form is what lets
 * you write a prerequisite like `botId: ["agent", "multi-agent"]` without
 * needing a predicate function.
 */
export type Prerequisites = {
  [K in keyof BotConfig]?: BotConfig[K] | BotConfig[K][];
};

export interface ABVariant {
  /** This name is the value stored under `ab_test_picks[testName]`. */
  name: string;
  overrides: Partial<BotConfig>;
}

export interface ABTest {
  /** This name is the key the chosen variant is stored under in `ab_test_picks`. */
  name: string;
  /**
   * An optional gate. When the config being built does not match these
   * prerequisites the test is skipped, and it writes no entry into the picks.
   */
  prerequisites?: Prerequisites;
  variants: { variant: ABVariant; weight: number }[];
  /**
   * The variant to assume when a `pipeline_runs.ab_test_picks` dictionary has no
   * entry for this test. A row written before the test existed looks like that.
   * This only takes effect for consumers that read the picks through
   * `resolvePicks`.
   *
   * Leave this unset on a test that has prerequisites. There a missing entry
   * means the test did not fire, and `resolvePicks` cannot tell that apart from
   * a row written before the test existed.
   */
  defaultVariant?: string;
}

// --- AB_TESTS data ---

export const BOT_TEST: ABTest = {
  name: "bot",
  variants: [
    { variant: { name: "simple-bot",  overrides: { botId: "simple-bot" }}, weight: 100 },
    { variant: { name: "cheap-bot", overrides: {
      botId: "cheap-bot",
      model: "deepseek/deepseek-v4-flash",
      search_model: "deepseek/deepseek-v4-flash",
      writer_model: "deepseek/deepseek-v4-flash",
      note_needed_judge: true,
      // On the big_eval validation set, moving the judge from deepseek-v4-flash
      // to gemini-3-flash roughly halved the rate of hard false positives, from
      // 35% to 14%. Coverage rose at the same time, from 57% to 68% of notes
      // passing.
      note_judge_model: "google/gemini-3-flash-preview",
      verifier_model: "deepseek/deepseek-v4-flash",
      // The source verifier runs Gemini media analysis on links to TikTok,
      // Instagram, YouTube and images, then treats that analysis as the content
      // of the source. The text side of the verifier stays on DeepSeek. Only the
      // media description step uses Gemini, because DeepSeek cannot see images.
      verifier_accepts_media_sources: true,
      web_search: "searxng",
      // Turn on reasoning for deepseek-v4-flash. It is cheap. It also makes the
      // judge better at deciding whether a dispute is substantive, and the
      // writer better at deciding between reporting a dispute and returning
      // nothing.
      reasoning_effort: "high",
    }}, weight: 0 },
  ],
};

const SIMPLE_BOT_SEARCH_TEST: ABTest = {
  name: "simple_bot_search",
  prerequisites: { botId: "simple-bot" },
  variants: [
    // An August 2026 split across many models. Sonnet 5 stays the main arm, and
    // the other live arms carry small exploratory weights. The weights are
    // relative to each other rather than percentages, so they do not have to add
    // up to 100. A retired arm stays declared at weight 0, so that picks from
    // old runs still resolve to a variant.
    { variant: { name: "sonnet46-native",         overrides: { search_model: "anthropic/claude-sonnet-4.6",       web_search: "native" }},        weight: 0 },
    // Each Claude model appears twice, once with reasoning and once without. The
    // reasoning arm sets search_reasoning_effort to medium. The other arm leaves
    // it unset, and Claude then does no reasoning at all.
    { variant: { name: "sonnet5-native",          overrides: { search_model: "anthropic/claude-sonnet-5",         web_search: "native" }},        weight: 4 },
    { variant: { name: "sonnet5-native-medium",   overrides: { search_model: "anthropic/claude-sonnet-5",         web_search: "native", search_reasoning_effort: "medium" }}, weight: 2 },
    // The opus48-native arm garbled about 80% of its runs, because native web
    // search collided with the json_schema response format. The Opus arms run
    // Opus 5 now, and we are watching them for the same failure.
    { variant: { name: "opus48-native",           overrides: { search_model: "anthropic/claude-opus-4.8",         web_search: "native" }},        weight: 0 },
    { variant: { name: "opus5-native",            overrides: { search_model: "anthropic/claude-opus-5",           web_search: "native" }},        weight: 1 },
    { variant: { name: "opus5-native-medium",     overrides: { search_model: "anthropic/claude-opus-5",           web_search: "native", search_reasoning_effort: "medium" }}, weight: 1 },
    { variant: { name: "haiku45-native",          overrides: { search_model: "anthropic/claude-haiku-4.5",        web_search: "native" }},        weight: 0 },
    { variant: { name: "grok43-native",           overrides: { search_model: "x-ai/grok-4.3",                     web_search: "native_grok" }},   weight: 2 },
    { variant: { name: "grok45-native",           overrides: { search_model: "x-ai/grok-4.5",                     web_search: "native_grok" }},   weight: 2 },
    { variant: { name: "gemini3flash-native",     overrides: { search_model: "google/gemini-3-flash-preview",     web_search: "native_gemini" }}, weight: 1 },
    { variant: { name: "gemini35flash-native",    overrides: { search_model: "google/gemini-3.5-flash",           web_search: "native_gemini" }}, weight: 0 },
    { variant: { name: "gemini36flash-native",    overrides: { search_model: "google/gemini-3.6-flash",           web_search: "native_gemini" }}, weight: 2 },
    { variant: { name: "gemini31pro-native",      overrides: { search_model: "google/gemini-3.1-pro-preview",      web_search: "native_gemini" }}, weight: 1 },
    { variant: { name: "sonar-reasoning-pro",     overrides: { search_model: "perplexity/sonar-reasoning-pro",    web_search: "bundled" }},       weight: 0 },
    { variant: { name: "sonar-pro",               overrides: { search_model: "perplexity/sonar-pro",              web_search: "bundled" }},       weight: 0 },
    { variant: { name: "kimi-k26-searxng",        overrides: { search_model: "moonshotai/kimi-k2.6",              web_search: "searxng" }},       weight: 0 },
    { variant: { name: "kimi-k3-searxng",         overrides: { search_model: "moonshotai/kimi-k3",                web_search: "searxng" }},       weight: 2 },
    { variant: { name: "deepseek-v4pro-searxng",  overrides: { search_model: "deepseek/deepseek-v4-pro",          web_search: "searxng" }},       weight: 0 },
    { variant: { name: "deepseek-v4flash-searxng",overrides: { search_model: "deepseek/deepseek-v4-flash",        web_search: "searxng" }},       weight: 0 },
    { variant: { name: "glm5-searxng",            overrides: { search_model: "z-ai/glm-5",                        web_search: "searxng" }},       weight: 0 },
    { variant: { name: "glm52-searxng",           overrides: { search_model: "z-ai/glm-5.2",                      web_search: "searxng" }},       weight: 2 },
    { variant: { name: "deepseek-v32exp-searxng", overrides: { search_model: "deepseek/deepseek-v3.2-exp",        web_search: "searxng" }},       weight: 0 },
    { variant: { name: "qwen3max-searxng",        overrides: { search_model: "qwen/qwen3-max",                    web_search: "searxng" }},       weight: 0 },
    { variant: { name: "gpt5_4mini-native",       overrides: { search_model: "openai/gpt-5.4-mini",               web_search: "native_openai" }}, weight: 0 },
    { variant: { name: "gpt5-native",             overrides: { search_model: "openai/gpt-5",                      web_search: "native_openai" }}, weight: 0 },
    { variant: { name: "gpt5_6luna-native",       overrides: { search_model: "openai/gpt-5.6-luna",               web_search: "native_openai" }}, weight: 2 },
    { variant: { name: "gpt5_6terra-native",      overrides: { search_model: "openai/gpt-5.6-terra",              web_search: "native_openai" }}, weight: 2 },
    { variant: { name: "gpt5_6sol-native",        overrides: { search_model: "openai/gpt-5.6-sol",                web_search: "native_openai" }}, weight: 1 },
    { variant: { name: "mistral-large-3-searxng", overrides: { search_model: "mistralai/mistral-large-2512",      web_search: "searxng" }},       weight: 0 },
  ],
};

const SIMPLE_BOT_WRITER_TEST: ABTest = {
  name: "simple_bot_writer",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "sonnet",           overrides: { writer_model: "anthropic/claude-sonnet-4.6"   }}, weight: 40 },
    { variant: { name: "gemini-flash",     overrides: { writer_model: "google/gemini-3-flash-preview" }}, weight: 40 },
    { variant: { name: "sonnet5",          overrides: { writer_model: "anthropic/claude-sonnet-5"      }}, weight: 20 },
    { variant: { name: "deepseek-v4flash", overrides: { writer_model: "deepseek/deepseek-v4-flash"    }}, weight: 0 },
  ],
};

// Picks the model for simple-bot's text source verifier. The baseline is Gemini
// flash, which is also what DEFAULT_CONFIG.verifier_model says. The
// deepseek-v4-flash arm was trialled against it and now sits at weight 0, so
// only its picks from old runs still resolve. Media analysis is not affected by
// this test. It always runs on Gemini, whatever verifier_model says. This test
// has prerequisites, so it declares no defaultVariant.
const SIMPLE_BOT_VERIFIER_TEST: ABTest = {
  name: "simple_bot_verifier",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "gemini-flash",     overrides: { verifier_model: "google/gemini-3-flash-preview" }}, weight: 50 },
    { variant: { name: "deepseek-v4flash", overrides: { verifier_model: "deepseek/deepseek-v4-flash"    }}, weight: 0  },
  ],
};

// Adds an instruction to simple-bot's search prompt. On a political post it
// tells the search step to prefer sources that lean the same way as the post's
// author. The bet is that a correction cited to outlets the author already
// trusts is more likely to be rated helpful. The "on" arm used to be half of all
// runs and is now down to 10%, so "off" is the main arm. This test has
// prerequisites, so it declares no defaultVariant.
const SIMPLE_BOT_POLITICAL_SOURCES_TEST: ABTest = {
  name: "simple_bot_political_sources",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off", overrides: { search_political_sources: false } }, weight: 90 },
    { variant: { name: "on",  overrides: { search_political_sources: true  } }, weight: 10 },
  ],
};

// This test swapped simple-bot's search prompt for an "anti-pedantic" version.
// That prompt only reports a correction when the post's main claim or argument
// is wrong, never when a minor side detail is off. The bet was that pedantic
// nitpicks hurt both the helpful rate and the false positive rate.
//
// Jim closed the test on 2026-08-06 in favour of "on". Community Notes statuses
// settle within about 48 hours, so the audit counted a note as mature after 48
// hours rather than after two weeks. That keeps the most recent weeks in the
// sample, and those are the weeks where "on" led. Over the window where both
// arms were live, Jun 24 to Aug 3, settled notes came out at +7.1% net for "on"
// (n=945, 76% of rated notes helpful) against +6.1% for "off" (n=918, 73%).
//
// The winning prompt is now part of SEARCH_SYSTEM_PROMPT, so the flag no longer
// changes anything. Every weight is 0, which makes live sampling skip the test
// while picks from old runs still resolve. Reopen the test if settled outcomes
// reverse the gap once the recent weeks fully mature. This test has
// prerequisites, so it declares no defaultVariant.
const SIMPLE_BOT_ANTI_PEDANTIC_TEST: ABTest = {
  name: "simple_bot_anti_pedantic",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off", overrides: { search_anti_pedantic: false } }, weight: 0 },
    { variant: { name: "on",  overrides: { search_anti_pedantic: true  } }, weight: 0 },
  ],
};

// One three-arm test for the time-travel problem. The idea being tested is that
// a correction must have been accurate and fair at the moment the post was
// published. A claim that only later events made outdated is not an error.
//
// The three arms are:
//   off          Neither treatment.
//   instruction  The time-travel instruction, always on, added to both
//                simple-bot's search prompt and its writer prompt. One flag
//                drives both steps, because the two mechanisms overlap.
//   context      An extractor names the event time, code works out the gap
//                between the event and the post, and a post published within
//                the six-hour fog window gets a timing-context paragraph piped
//                into the writer's user message. Nothing is gated on it.
//
// Nathan chose a single three-arm test on 2026-08-05. The instruction and the
// context compete with each other rather than compose, so the cell with both on
// is a configuration we would never ship. Turning both on would also give the
// writer a double dose of caution on exactly the fog-window posts, where it
// might then abstain too often.
//
// A backtest on 2026-07-28 over 398 rated notes flagged 9 not-helpful notes
// against roughly 3 genuinely helpful ones. That removes 11% to 15% of the
// not-helpful notes and costs about 1% of the helpful ones. A companion rule
// about the absence of reports came out inverted in the same backtest, at 9
// helpful against 5 not-helpful, so it is left out here.
//
// Read the process metrics first. Watch the abstention rate as a guard, then
// Nathan's breaking-news tag rate. The cn_status per arm will stay underpowered
// for months. Each run writes its timing verdict to the tweet log under
// logs.timing.*. The background is in docs/improvement-menu-2026-07-25.md, item
// T2. This test supersedes TIME_TRAVEL_PROMPT_TEST below. It has prerequisites,
// so it declares no defaultVariant.
const TIMING_TREATMENT_TEST: ABTest = {
  name: "timing_treatment",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off",         overrides: { time_travel_prompt: false, timing_context: false } }, weight: 34 },
    { variant: { name: "instruction", overrides: { time_travel_prompt: true,  timing_context: false } }, weight: 33 },
    { variant: { name: "context",     overrides: { time_travel_prompt: false, timing_context: true  } }, weight: 33 },
  ],
};

// This test was retired on 2026-08-05 in favour of the "instruction" arm of
// TIMING_TREATMENT_TEST. It stays declared at weight 0 so that picks from old
// runs still resolve.
const TIME_TRAVEL_PROMPT_TEST: ABTest = {
  name: "time_travel_prompt",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off", overrides: { time_travel_prompt: false } }, weight: 0 },
    { variant: { name: "on",  overrides: { time_travel_prompt: true  } }, weight: 0 },
  ],
};

// Uses the claim-check search prompt. Its input is a claim plus an excerpt from
// a podcast, an interview or an article, rather than an X post. The "on" arm has
// weight 0, so production never samples it. The Common Notes pipeline forces it
// on instead, in src/everything/pipeline/checkClaims.ts. This test has
// prerequisites, so it declares no defaultVariant.
const SIMPLE_BOT_CLAIM_TEST: ABTest = {
  name: "search_claim",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off", overrides: { search_claim: false } }, weight: 100 },
    { variant: { name: "on",  overrides: { search_claim: true  } }, weight: 0   },
  ],
};

// Appends a block of example notes to simple-bot's writer system prompt. The
// examples are real notes that performed well, and they are all simple, direct
// and short. The question is whether concrete examples pull the writer toward
// that style better than a prompt that only states principles does. The writer
// model and every other step are the same in both arms, so the prompt is the
// only thing that differs. The test runs as an even split on simple-bot. Watch
// the helpful rate and the false positive rate of the "on" arm. This test has
// prerequisites, so it declares no defaultVariant.
const SIMPLE_BOT_WRITER_EXAMPLES_TEST: ABTest = {
  name: "simple_bot_writer_examples",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off", overrides: { writer_examples: false } }, weight: 50 },
    { variant: { name: "on",  overrides: { writer_examples: true  } }, weight: 50 },
  ],
};

// Adds an LLM step between simple-bot's search and its writer. The step pulls
// the individual corrections out of the search findings and grades each one as
// clear_error, minor_error, critical_context, useful_context or not_useful. The
// writer then sees only the corrections graded clear_error or critical_context,
// instead of the raw findings. When nothing grades that high, the run exits
// early with no_correction. The "off" arm is the current behaviour, where the
// writer sees the full findings. The two "on" arms trial Gemini 3 Flash against
// Sonnet 5 as the extractor. This test has prerequisites, so it declares no
// defaultVariant.
const SIMPLE_BOT_CORRECTION_EXTRACTION_TEST: ABTest = {
  name: "simple_bot_correction_extraction",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off",          overrides: { correction_extraction: false } }, weight: 34 },
    { variant: { name: "gemini3flash", overrides: { correction_extraction: true, correction_extraction_model: "google/gemini-3-flash-preview" } }, weight: 33 },
    { variant: { name: "sonnet5",      overrides: { correction_extraction: true, correction_extraction_model: "anthropic/claude-sonnet-5" } }, weight: 33 },
  ],
};

// A blocked-topic gate that runs before everything else, even before the
// note-needed prefilter. One deepseek-v4-flash call, with reasoning and no
// tools, checks the post against BLOCKED_TOPICS. On a hit the run is skipped and
// recorded as rejected with the reason blocked_topic. The gate is on for most
// runs, and a 33% "off" holdout measures which notes we give up on the blocked
// topics. The gate runs for every bot, so this test has no prerequisites. Its
// defaultVariant is "off", so rows written before the test resolve to running
// without the filter.
const TOPIC_FILTER_TEST: ABTest = {
  name: "topic_filter",
  defaultVariant: "off",
  variants: [
    { variant: { name: "off", overrides: { topic_filter: false } }, weight: 33 },
    { variant: { name: "on",  overrides: { topic_filter: true  } }, weight: 67 },
  ],
};

// A cheap deepseek-v4-flash note-needed prefilter that runs before the bot and
// skips it when no note is warranted. Such a run is recorded as rejected with
// the reason prefilter_no_note. This prefilter is what makes the large feed
// affordable. The test ran as an even split for a while, so that we could
// measure in production how often the bot writes a note on a post the prefilter
// would have cut. That number is the real false-negative rate.
//
// The test closed on 2026-08-06 with the deepseek arm at 100. Over the window
// where both arms ran, and counting a note as settled after 48 hours, deepseek
// came out at +7.0% net (n=2085, 75% of rated notes helpful) against +6.6% for
// off (n=774, 73%). Quality is the same either way, the prefilter saves the cost
// of a search, and the off arm had nothing left to teach us.
//
// A scheduled discard audit now does the job the off arm used to do. It samples
// tweets the prefilter rejected, runs the full pipeline over them with a null
// logger, and inspects the notes we would have written. Reopen this test if that
// audit finds that we are losing real notes. The defaultVariant is "off", so a
// row with no pick resolves through resolvePicks to running without the
// prefilter.
const NOTE_PREFILTER_TEST: ABTest = {
  name: "note_prefilter",
  defaultVariant: "off",
  variants: [
    { variant: { name: "off",      overrides: { note_prefilter: false } }, weight: 0 },
    { variant: { name: "deepseek", overrides: { note_prefilter: true  } }, weight: 100 },
  ],
};

// Chooses the model for cheap-bot's note-needed judge, which is our main guard
// against false positives. The cheap-bot variant of BOT_TEST sets the baseline
// of gemini-3-flash. This test swaps only the judge model and holds the writer,
// the verifier and the search constant. That way a replay from cached writer
// output leaves the judge model as the only thing that changed.
//
// gemini3flash won the comparison on the big_eval validation set. It had the
// lowest rate of hard false positives at 14%, and 68% of notes passed.
// deepseek-v4flash came in at 35% false positives, deepseek-v4pro at 16% but
// rejecting too many good notes, and sonnet46 at 18%.
//
// This test has prerequisites, so it declares no defaultVariant. resolvePicks
// cannot evaluate prerequisites, and a missing pick already falls back to the
// note_judge_model that BOT_TEST set.
const CHEAP_BOT_JUDGE_MODEL_TEST: ABTest = {
  name: "cheap_bot_judge_model",
  prerequisites: { botId: "cheap-bot" },
  variants: [
    { variant: { name: "gemini3flash",     overrides: { note_judge_model: "google/gemini-3-flash-preview" } }, weight: 100 },
    { variant: { name: "deepseek-v4flash", overrides: { note_judge_model: "deepseek/deepseek-v4-flash"   } }, weight: 0 },
    { variant: { name: "deepseek-v4pro",   overrides: { note_judge_model: "deepseek/deepseek-v4-pro"     } }, weight: 0 },
    { variant: { name: "sonnet46",         overrides: { note_judge_model: "anthropic/claude-sonnet-4.6"  } }, weight: 0 },
  ],
};

// Runs gemini-3-flash for exactly the two steps where it helped the big_eval
// validation set most. Those are the search analyzer, which synthesises the
// evidence, and the note-needed judge, which guards against false positives.
// Every other step stays on deepseek-v4-flash: the query writer, the satire
// detector, the writer and the verifier.
//
// CHEAP_BOT_JUDGE_MODEL_TEST has already put the judge on gemini, so this test
// only has to route the analyzer to gemini through search_analyzer_model, and
// pin the satire detector back to deepseek through satire_model. Without that
// pin the satire detector would follow note_judge_model. This test is declared
// after CHEAP_BOT_JUDGE_MODEL_TEST so that its overrides win. It has
// prerequisites, so it declares no defaultVariant.
const CHEAP_BOT_GEMINI_STEPS_TEST: ABTest = {
  name: "cheap_bot_gemini_steps",
  prerequisites: { botId: "cheap-bot" },
  variants: [
    { variant: { name: "deepseek-baseline", overrides: {} }, weight: 0 },
    { variant: { name: "gemini-analyzer-judge", overrides: {
      search_analyzer_model: "google/gemini-3-flash-preview",
      satire_model: "deepseek/deepseek-v4-flash",
    } }, weight: 100 },
  ],
};

// Replaces the chain of query writer, SearXNG and analyzer with a single Gemini
// call that uses Gemini's own googleSearch tool. Gemini issues its own queries
// and returns a findings brief directly. The writer, judge and verifier gates
// are unchanged. The cheap-bot orchestrator branches on web_search being
// "native_gemini". The native variant also sets search_model, because its search
// call has to go to Gemini. This test has prerequisites, so it declares no
// defaultVariant.
const CHEAP_BOT_NATIVE_SEARCH_TEST: ABTest = {
  name: "cheap_bot_native_search",
  prerequisites: { botId: "cheap-bot" },
  variants: [
    { variant: { name: "searxng", overrides: {} }, weight: 50 },
    { variant: { name: "native-gemini", overrides: {
      web_search: "native_gemini",
      search_model: "google/gemini-3-flash-preview",
    } }, weight: 50 },
  ],
};

const VERIFIER_MEDIA_SOURCES_TEST: ABTest = {
  name: "verifier_media_sources",
  variants: [
    { variant: { name: "reject", overrides: { verifier_accepts_media_sources: false } }, weight: 0 },
    { variant: { name: "accept", overrides: { verifier_accepts_media_sources: true  } }, weight: 100 },
  ],
};

// Compares a two-call claim-based source verifier against the single-call flow
// that only accepts or rejects each source. The claim-based flow first extracts
// the note's distinct claims. It then maps each claim to the cited sources that
// support it. It submits the good sources only when every claim has one.
// verifySources runs in both simple-bot and cheap-bot, so this test has no
// prerequisites. Its defaultVariant is "classic", which resolves rows written
// before the test to the older flow.
const VERIFIER_CLAIM_BASED_TEST: ABTest = {
  name: "verifier_claim_based",
  defaultVariant: "classic",
  variants: [
    { variant: { name: "classic",     overrides: { verifier_claim_based: false } }, weight: 50 },
    { variant: { name: "claim-based", overrides: { verifier_claim_based: true  } }, weight: 50 },
  ],
};

// A source verifier that reasons before it judges. For each source it first
// gathers verbatim snippets and a plain-language explanation of how the source
// supports or refutes the note. Only then does it call the source good or bad.
// This test is independent of verifier_claim_based. Both of those flows have a
// citations variant, so the two tests can be combined freely. verifySources runs
// in both bots, so this test has no prerequisites. Its defaultVariant is "off",
// which lets rows written before the test resolve.
const VERIFIER_CITATIONS_TEST: ABTest = {
  name: "verifier_citations",
  defaultVariant: "off",
  variants: [
    { variant: { name: "off", overrides: { verifier_citations: false } }, weight: 50 },
    { variant: { name: "on",  overrides: { verifier_citations: true  } }, weight: 50 },
  ],
};

// This is not a real A/B test. It records which feed tier the post came from, so
// that note outcomes can be sliced by tier. The small feed is X's curated
// subset, and each larger tier is a lower-quality superset of it.
//
// Nothing is sampled here. `processPosts` forces the pick from the item's
// `feedSize`, which the ladder in `collectFastPosts` already tracks per post, as
// do the crawls in the pre-passes. The overrides are empty because this only
// records the tier. The tier itself is decided when the posts are fetched.
//
// A row with no pick resolves to `small`. That was true of everything before the
// ladder landed on 2026-06-06. It is also the right fallback for the window from
// 2026-07-21 to 2026-07-22, when the pick was dropped by accident. Small
// dominates that window too, because the ladder only reaches for a larger tier
// when small cannot fill the run.
const FEED_SIZE_TEST: ABTest = {
  name: "feed_size",
  defaultVariant: "small",
  variants: [
    { variant: { name: "small", overrides: {} }, weight: 100 },
    { variant: { name: "large", overrides: {} }, weight: 0 },
    { variant: { name: "xl",    overrides: {} }, weight: 0 },
    { variant: { name: "xxl",   overrides: {} }, weight: 0 },
  ],
};

// This test and the topic test below are not real A/B tests. Together they
// record whether a run came from the misinfo pre-pass over the XXL feed, and if
// it did, which topic it matched. `processPosts` forces both picks from the
// item's MonitoringContext. A regular run carries no monitoring, so it lands on
// the default arm, which is `no` here and `none` for the topic test. The
// overrides are empty because these tests only record. They change no
// behaviour. The reference document reaches the prompts through
// MonitoringContext, which is separate from BotConfig.
const MISINFO_MONITORING_TEST: ABTest = {
  name: "misinfo_monitoring",
  defaultVariant: "no",
  variants: [
    { variant: { name: "no",  overrides: {} }, weight: 100 },
    { variant: { name: "yes", overrides: {} }, weight: 0 },
  ],
};

// There is one variant per topic id. The list comes from MISINFO_TOPIC_IDS,
// which keeps it in step with topics.ts. That way a forced topic pick always
// finds its variant in findVariantByName.
const MISINFO_TOPIC_TEST: ABTest = {
  name: "misinfo_topic",
  defaultVariant: "none",
  variants: [
    { variant: { name: "none", overrides: {} }, weight: 100 },
    ...MISINFO_TOPIC_IDS.map((id) => ({ variant: { name: id, overrides: {} }, weight: 0 })),
  ],
};

// This is not a real A/B test. It records whether a run came from the Pangram
// AI-detection pre-pass over the XXL feed. generatePangramCandidates forces
// `yes` on the runs it creates. Every other run carries no pick and resolves to
// the default, `no`. The overrides are empty because this only records. It
// changes no behaviour.
const PANGRAM_MONITORING_TEST: ABTest = {
  name: "pangram_monitoring",
  defaultVariant: "no",
  variants: [
    { variant: { name: "no",  overrides: {} }, weight: 100 },
    { variant: { name: "yes", overrides: {} }, weight: 0 },
  ],
};

// An even split that asks whether the Pangram AI-detection note is rated
// differently when it also reassures the reader about the false positive rate
// and cites two sources for that. generatePangramCandidates reads this pick
// directly through pickVariantName and passes it to buildPangramNote. The pick
// never goes through BotConfig, so the overrides are empty.
export const PANGRAM_NOTE_TEST: ABTest = {
  name: "pangram_note",
  defaultVariant: "plain",
  variants: [
    { variant: { name: "plain",      overrides: {} }, weight: 50 },
    { variant: { name: "fp_context", overrides: {} }, weight: 50 },
  ],
};

const SEARCH_ANALYZER_TEST: ABTest = {
  name: "search_analyzer",
  prerequisites: { botId: "cheap-bot" },
  variants: [
    { variant: { name: "off", overrides: { search_analyzer: false } }, weight: 0 },
    { variant: { name: "on",  overrides: { search_analyzer: true  } }, weight: 100 },
  ],
};

// A satire gate that runs before the search. It reads the post, its comments and
// the author's profile, but no note. When the post is obvious satire that its
// audience is in on, the run exits before the query writer. The gate is tuned
// for precision. The note-needed judge still keeps a lighter satire check behind
// it.
const SATIRE_DETECTOR_TEST: ABTest = {
  name: "satire_detector",
  prerequisites: { botId: "cheap-bot" },
  variants: [
    { variant: { name: "off", overrides: { satire_detector: false } }, weight: 0 },
    { variant: { name: "on",  overrides: { satire_detector: true  } }, weight: 100 },
  ],
};

// Pins every cheap-bot LLM call to temperature 0. At the model's default
// temperature the judge and the verifier were so unpredictable that about 58% of
// eval rows changed their answer from one run to the next. That noise swamped
// the signal from any prompt change. This test is gated to cheap-bot, so the
// other bots keep their default sampling.
const CHEAP_BOT_TEMPERATURE_TEST: ABTest = {
  name: "cheap_bot_temperature",
  prerequisites: { botId: "cheap-bot" },
  variants: [
    { variant: { name: "default", overrides: {} },               weight: 0 },
    { variant: { name: "zero",    overrides: { temperature: 0 } }, weight: 100 },
  ],
};

// The eval score cutoff for submitting a note. The X eval gate keeps a note only
// when its `claim_opinion_score` is at least `eval_submit_threshold`. The cutoff
// is fixed at -3, so every note scoring below -3 is filtered out. The older arms
// at 0 and -6 sit at weight 0, and they stay declared so that their historical
// picks resolve. The eval gate runs for every bot inside processTweet, so this
// test has no prerequisites. Its defaultVariant is "0", which resolves rows
// written before the test to the original cutoff.
const EVAL_SUBMIT_THRESHOLD_TEST: ABTest = {
  name: "eval_submit_threshold",
  defaultVariant: "0",
  variants: [
    { variant: { name: "-3", overrides: { eval_submit_threshold: -3 } }, weight: 100 },
    { variant: { name: "0",  overrides: { eval_submit_threshold: 0  } }, weight: 0   },
    { variant: { name: "-6", overrides: { eval_submit_threshold: -6 } }, weight: 0   },
  ],
};

// Puts the post author's past helpful community notes into the writer's user
// message. That covers both our own notes and competing notes on tweets we have
// noted. See getAuthorNoteHistory. The lookup was silently broken from migration
// 033 until June 2026, because it queried pipeline_runs.author_id after that
// column had been dropped. So this input was effectively off for that whole
// period. createBotInput gathers the input for every bot, so this test has no
// prerequisites. Its defaultVariant is "off", which resolves older rows to the
// behaviour they actually had, with no author context.
//
// The one open question left is an even split. Does it help to add the author's
// rejected notes to that block as well? About 10% of the posts we process come
// from an author with at least one not-helpful note on record. Those rejections
// are the tell of a satire or opinion account, and both the writer and the
// note-needed prefilter get to see them. The arm with no history is pinned to
// weight 0. It stays declared so that its historical picks and the
// defaultVariant still resolve.
const AUTHOR_HISTORY_TEST: ABTest = {
  name: "author_history",
  defaultVariant: "off",
  variants: [
    { variant: { name: "off", overrides: { author_history: false } }, weight: 0  },
    { variant: { name: "on",  overrides: { author_history: true  } }, weight: 50 },
    {
      variant: {
        name: "on_with_unhelpful",
        overrides: { author_history: true, author_history_unhelpful: true },
      },
      weight: 50,
    },
  ],
};

export const AB_TESTS: ABTest[] = [
  BOT_TEST,
  SIMPLE_BOT_SEARCH_TEST,
  SIMPLE_BOT_WRITER_TEST,
  SIMPLE_BOT_VERIFIER_TEST,
  SIMPLE_BOT_ANTI_PEDANTIC_TEST,
  TIME_TRAVEL_PROMPT_TEST,
  TIMING_TREATMENT_TEST,
  SIMPLE_BOT_CLAIM_TEST,
  SIMPLE_BOT_WRITER_EXAMPLES_TEST,
  SIMPLE_BOT_POLITICAL_SOURCES_TEST,
  SIMPLE_BOT_CORRECTION_EXTRACTION_TEST,
  TOPIC_FILTER_TEST,
  NOTE_PREFILTER_TEST,
  CHEAP_BOT_JUDGE_MODEL_TEST,
  CHEAP_BOT_GEMINI_STEPS_TEST,
  CHEAP_BOT_NATIVE_SEARCH_TEST,
  VERIFIER_MEDIA_SOURCES_TEST,
  VERIFIER_CLAIM_BASED_TEST,
  VERIFIER_CITATIONS_TEST,
  SEARCH_ANALYZER_TEST,
  SATIRE_DETECTOR_TEST,
  CHEAP_BOT_TEMPERATURE_TEST,
  EVAL_SUBMIT_THRESHOLD_TEST,
  FEED_SIZE_TEST,
  MISINFO_MONITORING_TEST,
  MISINFO_TOPIC_TEST,
  PANGRAM_MONITORING_TEST,
  PANGRAM_NOTE_TEST,
  AUTHOR_HISTORY_TEST,
];
