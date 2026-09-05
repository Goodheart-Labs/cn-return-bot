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
import { MISINFO_TOPIC_IDS, CONCEDE_SHAPE_TOPIC_IDS } from "../misinfo-monitoring/topicIds";

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
    { variant: { name: "kimi-k26-searxng",        overrides: { search_model: "moonshotai/kimi-k2.6",              web_search: "serper" }},       weight: 0 },
    { variant: { name: "kimi-k3-searxng",         overrides: { search_model: "moonshotai/kimi-k3",                web_search: "serper" }},       weight: 0 },
    // The -serper arms took over from the -searxng arms of the same models in
    // September 2026, when Serper replaced the SearXNG search backend. A new
    // backend is a new treatment, so the arms restart under new names. The
    // -searxng names stay declared at weight 0 for historical replays; their
    // overrides point at the current backend, because a replay runs today's code.
    { variant: { name: "kimi-k3-serper",          overrides: { search_model: "moonshotai/kimi-k3",                web_search: "serper" }},       weight: 2 },
    { variant: { name: "deepseek-v4pro-searxng",  overrides: { search_model: "deepseek/deepseek-v4-pro",          web_search: "serper" }},       weight: 0 },
    { variant: { name: "deepseek-v4flash-searxng",overrides: { search_model: "deepseek/deepseek-v4-flash",        web_search: "serper" }},       weight: 0 },
    { variant: { name: "glm5-searxng",            overrides: { search_model: "z-ai/glm-5",                        web_search: "serper" }},       weight: 0 },
    { variant: { name: "glm52-searxng",           overrides: { search_model: "z-ai/glm-5.2",                      web_search: "serper" }},       weight: 0 },
    { variant: { name: "glm52-serper",            overrides: { search_model: "z-ai/glm-5.2",                      web_search: "serper" }},       weight: 2 },
    { variant: { name: "deepseek-v32exp-searxng", overrides: { search_model: "deepseek/deepseek-v3.2-exp",        web_search: "serper" }},       weight: 0 },
    { variant: { name: "qwen3max-searxng",        overrides: { search_model: "qwen/qwen3-max",                    web_search: "serper" }},       weight: 0 },
    { variant: { name: "gpt5_4mini-native",       overrides: { search_model: "openai/gpt-5.4-mini",               web_search: "native_openai" }}, weight: 0 },
    { variant: { name: "gpt5-native",             overrides: { search_model: "openai/gpt-5",                      web_search: "native_openai" }}, weight: 0 },
    { variant: { name: "gpt5_6luna-native",       overrides: { search_model: "openai/gpt-5.6-luna",               web_search: "native_openai" }}, weight: 2 },
    { variant: { name: "gpt5_6terra-native",      overrides: { search_model: "openai/gpt-5.6-terra",              web_search: "native_openai" }}, weight: 2 },
    { variant: { name: "gpt5_6sol-native",        overrides: { search_model: "openai/gpt-5.6-sol",                web_search: "native_openai" }}, weight: 1 },
    { variant: { name: "mistral-large-3-searxng", overrides: { search_model: "mistralai/mistral-large-2512",      web_search: "serper" }},       weight: 0 },
  ],
};

const SIMPLE_BOT_WRITER_TEST: ABTest = {
  name: "simple_bot_writer",
  prerequisites: { botId: "simple-bot" },
  // Refreshed 2026-08-18: Sonnet 5 promoted to co-baseline, Sonnet 4.6 wound
  // down to a small continuity arm, and two current-generation Anthropic arms
  // added (Fable 5 at $10/$50, Opus 5 at $5/$25 per MTok — low weights keep
  // the cost a few notes/day each).
  // The Sonnet 4.6 continuity arm was retired on 2026-09-02. In August it tied
  // Sonnet 5 exactly, 12.6% of settled notes helpful on each arm, so it had
  // nothing left to add. Its weight moved to Sonnet 5.
  variants: [
    { variant: { name: "sonnet5",          overrides: { writer_model: "anthropic/claude-sonnet-5"      }}, weight: 50 },
    { variant: { name: "gemini-flash",     overrides: { writer_model: "google/gemini-3-flash-preview" }}, weight: 30 },
    { variant: { name: "fable5",           overrides: { writer_model: "anthropic/claude-fable-5"      }}, weight: 10 },
    { variant: { name: "opus5",            overrides: { writer_model: "anthropic/claude-opus-5"       }}, weight: 10 },
    { variant: { name: "sonnet",           overrides: { writer_model: "anthropic/claude-sonnet-4.6"   }}, weight: 0 },
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
//
// The off arm was retired on 2026-08-23 (Nathan's call, on the first 7-day-
// labeled readout): off +6.0% net of labeled (26H/11NH, n=248), context +10.0%
// (31H/8NH, n=229), instruction +12.2% (33H/6NH, n=222) — both treatments also
// lifted rated-at-all (~15% -> ~17.5%). Treatments-vs-off was z≈1.7, suggestive
// rather than decisive, but it points the same way as the 2026-07-28 backtest,
// and the control was plausibly costing ~5pp net on a third of traffic. The
// off arm stays declared at weight 0 so picks from old runs still resolve;
// context vs instruction keeps running 50/50 to decide which treatment wins.
const TIMING_TREATMENT_TEST: ABTest = {
  name: "timing_treatment",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off",         overrides: { time_travel_prompt: false, timing_context: false } }, weight: 0 },
    { variant: { name: "instruction", overrides: { time_travel_prompt: true,  timing_context: false } }, weight: 50 },
    { variant: { name: "context",     overrides: { time_travel_prompt: false, timing_context: true  } }, weight: 50 },
  ],
};

// Gives the writer a "Last check" block: draft the note, read it as a rater
// would, and return empty if the post is a joke or an opinion, the post was
// early rather than wrong, the dispute is over a definition, the note only holds
// with a qualifier, corrects a side detail, rests on an absence of evidence, or
// only says the media is AI-made. Two corrections collapse to the strongest one.
//
// The trigger was the Lindsay Clancy mistrial note of 2026-09-04, which hedged
// itself with "at post time" and was rated not helpful within hours. Of the 57
// not-helpful notes from the 30 days before that, about 35 fall into modes the
// writer could have seen at draft time; the rest are correct notes that raters
// rejected. The classification is in docs/not-helpful-modes-2026-09-04.md.
//
// Read the abstention rate first as a guard, then net helpful of labeled at 48
// hours. This test has prerequisites, so it declares no defaultVariant.
const WRITER_LAST_CHECK_TEST: ABTest = {
  name: "writer_last_check",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off", overrides: { writer_last_check: false } }, weight: 50 },
    { variant: { name: "on",  overrides: { writer_last_check: true  } }, weight: 50 },
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

// The concede-then-correct note shape for curated misinfo topics, from Rob on
// 2026-07-27. The "on" arm sees the topic document's marker-wrapped additions
// in every step. Those additions are the "Note shape — concede the true core
// first" section and the "True core" line of each claim. The writer on that arm
// also gets MISINFO_CONCEDE_SHAPE_RULE. The "off" arm sees the document exactly
// as it was before the experiment. Rating analysis of this topic's notes found
// that the worst-rejected one sidestepped the true core of the post's claim,
// and 73% of its raters tagged it "missing key points" — they read the omission
// as evasive. Only runs on an enrolled topic sample a pick: the prerequisite
// matches the misinfo_topic config field, which MISINFO_TOPIC_TEST records,
// against the CONCEDE_SHAPE_TOPIC_IDS roster. This test must therefore come
// after that one in AB_TESTS. This test has prerequisites, so it declares no
// defaultVariant.
const MISINFO_CONCEDE_SHAPE_TEST: ABTest = {
  name: "misinfo_concede_shape",
  prerequisites: { botId: "simple-bot", misinfo_topic: CONCEDE_SHAPE_TOPIC_IDS },
  variants: [
    { variant: { name: "off", overrides: { concede_shape: false } }, weight: 50 },
    { variant: { name: "on",  overrides: { concede_shape: true  } }, weight: 50 },
  ],
};

// Adds an LLM step between simple-bot's search and its writer. The step pulls
// the individual corrections out of the search findings and grades each one as
// clear_error, minor_error, critical_context, useful_context or not_useful. The
// writer then sees only the corrections graded clear_error or critical_context,
// instead of the raw findings. When nothing grades that high, the run exits
// early with no_correction. The "off" arm is the current behaviour, where the
// writer sees the full findings. The two "on" arms trialled Gemini 3 Flash
// against Sonnet 5 as the extractor.
//
// Jim closed the test on 2026-09-02 in favour of "off". Counting a note as
// settled 48 hours after submission, "off" led in both windows: since Aug 1 it
// was at +10.3% net (n=622, 13.3% of settled notes helpful) against +8.7% for
// gemini3flash (n=583) and +9.1% for sonnet5 (n=560), z about 0.9 against each
// extractor arm. The extraction step also costs an extra LLM call per run. The
// extractor arms stay declared at weight 0 so picks from old runs still
// resolve. This test has prerequisites, so it declares no defaultVariant.
const SIMPLE_BOT_CORRECTION_EXTRACTION_TEST: ABTest = {
  name: "simple_bot_correction_extraction",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off",          overrides: { correction_extraction: false } }, weight: 100 },
    { variant: { name: "gemini3flash", overrides: { correction_extraction: true, correction_extraction_model: "google/gemini-3-flash-preview" } }, weight: 0 },
    { variant: { name: "sonnet5",      overrides: { correction_extraction: true, correction_extraction_model: "anthropic/claude-sonnet-5" } }, weight: 0 },
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
//
// Jim closed the test on 2026-09-02 in favour of "claim-based". The two flows
// were statistically tied on quality per submitted note (z about 1.1 on the
// helpful rate), but they differ a lot in strictness. In August, from equal
// traffic, classic submitted 1235 notes (134 helpful, 39 not helpful) while
// claim-based submitted 698 (86 helpful, 15 not helpful). Jim chose the
// stricter flow: fewer unhelpful notes reach X, at the cost of volume. The
// classic arm stays declared at weight 0 so picks from old runs still resolve.
// verifySources runs for every bot, so this test has no prerequisites. Its
// defaultVariant is "classic", which resolves rows written before the test to
// the older flow.
const VERIFIER_CLAIM_BASED_TEST: ABTest = {
  name: "verifier_claim_based",
  defaultVariant: "classic",
  variants: [
    { variant: { name: "classic",     overrides: { verifier_claim_based: false } }, weight: 0 },
    { variant: { name: "claim-based", overrides: { verifier_claim_based: true  } }, weight: 100 },
  ],
};

// A source verifier that reasons before it judges. For each source it first
// gathers verbatim snippets and a plain-language explanation of how the source
// supports or refutes the note. Only then does it call the source good or bad.
// This test is independent of verifier_claim_based. Both of those flows have a
// citations variant, so the two tests can be combined freely.
//
// Jim closed the test on 2026-09-02 in favour of "off". After seven weeks and
// about 2100 settled notes, "off" sat slightly ahead (since Aug 1: +10.5% net,
// n=866, against +8.3%, n=899; z about 0.9 on the helpful rate), so the extra
// reasoning bought nothing on X. The Common Notes pipeline still forces "on"
// in src/everything/pipeline/checkClaims.ts, because its public site displays
// the per-source quotes; that forced pick resolves against the arm declared at
// weight 0 here. verifySources runs in both bots, so this test has no
// prerequisites. Its defaultVariant is "off", which lets rows written before
// the test resolve.
const VERIFIER_CITATIONS_TEST: ABTest = {
  name: "verifier_citations",
  defaultVariant: "off",
  variants: [
    { variant: { name: "off", overrides: { verifier_citations: false } }, weight: 100 },
    { variant: { name: "on",  overrides: { verifier_citations: true  } }, weight: 0 },
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
// the default arm, which is `no` here and `none` for the topic test. These
// tests change no behaviour. The reference document reaches the prompts
// through MonitoringContext, which is separate from BotConfig.
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
// finds its variant in findVariantByName. Each topic variant also records its
// ID into the misinfo_topic config field, so a test declared after this one
// can gate on specific topics through its prerequisites.
// MISINFO_CONCEDE_SHAPE_TEST does that. The `none` variant leaves the field
// unset, so a topic-gated test can never fire on a regular run.
const MISINFO_TOPIC_TEST: ABTest = {
  name: "misinfo_topic",
  defaultVariant: "none",
  variants: [
    { variant: { name: "none", overrides: {} }, weight: 100 },
    ...MISINFO_TOPIC_IDS.map((id) => ({ variant: { name: id, overrides: { misinfo_topic: id } }, weight: 0 })),
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
// The "off" arm was retired earlier because it was clearly worse: over the
// whole test it reached only +3.5% net (n=579) against +8.4% and +8.9% for the
// two history arms, z about 3.4 on the helpful rate. That is the one decisive
// result of the 2026-09-01 A/B review.
//
// Jim closed the remaining question on 2026-09-02 in favour of
// "on_with_unhelpful". After five weeks the two history arms were
// indistinguishable (since Aug 1: 12.1% against 12.8% of settled notes
// helpful, z about 0.4), so the rejected-notes block costs nothing, and it has
// a plausible mechanism as the tell of a satire or opinion account. The other
// arms stay declared at weight 0 so historical picks and the defaultVariant
// still resolve.
const AUTHOR_HISTORY_TEST: ABTest = {
  name: "author_history",
  defaultVariant: "off",
  variants: [
    { variant: { name: "off", overrides: { author_history: false } }, weight: 0 },
    { variant: { name: "on",  overrides: { author_history: true  } }, weight: 0 },
    {
      variant: {
        name: "on_with_unhelpful",
        overrides: { author_history: true, author_history_unhelpful: true },
      },
      weight: 100,
    },
  ],
};

// Picked once per run in runPipeline and forced onto every post of that run,
// because ordering belongs to the batch. Names are scorer names.
export const RANKING_POLICY_TEST: ABTest = {
  name: "ranking_policy",
  defaultVariant: "velocity_only",
  variants: [
    { variant: { name: "velocity_only",   overrides: { ranking_policy: "velocity_only"   } }, weight: 50 },
    { variant: { name: "flags_then_eval", overrides: { ranking_policy: "flags_then_eval" } }, weight: 50 },
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
  WRITER_LAST_CHECK_TEST,
  SIMPLE_BOT_CLAIM_TEST,
  SIMPLE_BOT_CORRECTION_EXTRACTION_TEST,
  TOPIC_FILTER_TEST,
  NOTE_PREFILTER_TEST,
  VERIFIER_MEDIA_SOURCES_TEST,
  VERIFIER_CLAIM_BASED_TEST,
  VERIFIER_CITATIONS_TEST,
  EVAL_SUBMIT_THRESHOLD_TEST,
  FEED_SIZE_TEST,
  MISINFO_MONITORING_TEST,
  MISINFO_TOPIC_TEST,
  // This must come after MISINFO_TOPIC_TEST, because its prerequisite reads
  // the misinfo_topic config field that test records.
  MISINFO_CONCEDE_SHAPE_TEST,
  PANGRAM_MONITORING_TEST,
  PANGRAM_NOTE_TEST,
  AUTHOR_HISTORY_TEST,
  RANKING_POLICY_TEST,
];
