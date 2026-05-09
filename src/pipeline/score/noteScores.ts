/**
 * Note Scores
 *
 * LLM-based scores for evaluating note quality across multiple dimensions.
 * All scores are observational — stored in pipeline_scores for analysis.
 * Scores can be promoted to hard rejection gates once correlated with H/NH outcomes.
 */

import { llm } from "../llm/llm";
import { getTweetLog, formatLlmMessages } from "../utils/tweetLog";

export interface NoteScore {
  name: string;
  score: number; // 0-1 decimal
  passed: boolean; // score > 0.5
  reasoning: string;
  llmContext?: string;
  llmResponse?: string;
  llmDurationMs?: number;
}

export interface AllNoteScores {
  positiveEvidence: NoteScore;
  disagreement: NoteScore;
  helpfulness: NoteScore;
  sourceQuality: NoteScore;
  breakingNewsRisk: NoteScore;
  pedantry: NoteScore;
  noteNotNeeded: NoteScore;
  tangentialCorrection: NoteScore;
  raterVerifiability: NoteScore;
  overconfidence: NoteScore;
}

/** Default model for note scores */
const DEFAULT_SCORING_MODEL = "anthropic/claude-sonnet-4.6";

const SCORE_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "score_response",
    strict: true,
    schema: {
      type: "object",
      properties: {
        score: { type: "number", description: "Score between 0 and 1" },
        reasoning: { type: "string", description: "Single sentence explanation" },
      },
      required: ["score", "reasoning"],
      additionalProperties: false,
    },
  },
};

/**
 * Helper to call LLM and parse a scored response.
 */
async function scoreWithLLM(
  name: string,
  prompt: string,
  model: string,
  defaultOnError = 0.5
): Promise<NoteScore> {
  try {
    const messages = [{ role: "user" as const, content: prompt }];
    const startMs = Date.now();
    const result = await llm.create({
      model,
      temperature: 0.2,
      response_format: SCORE_RESPONSE_FORMAT,
      messages,
    });
    const content = result.choices?.[0]?.message?.content || "{}";
    const durationMs = Date.now() - startMs;
    const parsed: { score: number; reasoning: string } = JSON.parse(content);
    return { name, score: parsed.score, passed: parsed.score > 0.5, reasoning: parsed.reasoning,
      llmContext: formatLlmMessages(messages), llmResponse: content, llmDurationMs: durationMs };
  } catch (error) {
    console.error(`[noteScores] Error in ${name}:`, error);
    return { name, score: defaultOnError, passed: defaultOnError > 0.5, reasoning: "Error, defaulting" };
  }
}

/**
 * Positive evidence — does the note rely on positive counter-evidence or on
 * negative framing / absence of evidence?
 * Merges the old "positive claims" and "absence of evidence" checks.
 */
export async function checkPositiveEvidence(
  noteText: string,
  model: string = DEFAULT_SCORING_MODEL
): Promise<NoteScore> {
  return scoreWithLLM("Positive evidence", `A Community Note is being evaluated. Does it make its correction using positive counter-evidence (specific facts, named sources, documented events) or does it rely on negative framing or absence of evidence?

Negative framing examples: "there is no evidence that", "no reports confirm", "no official confirmation", "they never said", "this didn't happen", "I found no sources that..."
Positive evidence examples: "The actual figure is X per source Y", "Reuters reported on [date] that...", "The official statement confirmed...", "X actually happened — source Z shows..."

Community Note: "${noteText}"

Scoring:
- 0.0: Entirely negative — correction is based on absence of evidence or negative claims only
- 0.3: Mostly negative — relies on not finding evidence, with little positive support
- 0.5: Mixed — some positive evidence but also negative/absence framing
- 0.7: Mostly positive — grounded in specific facts/sources, minor negative phrasing
- 1.0: Entirely positive — all claims backed by specific named counter-evidence

IMPORTANT: Return ONLY a JSON object with:
- score: a number between 0 and 1
- reasoning: a single sentence`, model);
}

/**
 * Substantive disagreement — does the note truly disagree with the tweet?
 */
export async function checkSubstantiveDisagreement(
  noteText: string,
  postText: string,
  model: string = DEFAULT_SCORING_MODEL
): Promise<NoteScore> {
  return scoreWithLLM("Substantive disagreement", `Evaluate if the Community Note substantively disagrees with the original post.

Original post: "${postText}"
Community Note: "${noteText}"

Consider:
- Do they actually contradict each other?
- Is the note just adding context or truly disagreeing?
- Is there a meaningful factual conflict?

Scoring:
- 0.0: No disagreement at all (just adding context)
- 0.3: Minor disagreement on details
- 0.5: Some disagreement but not central
- 0.7: Clear disagreement on main points
- 1.0: Complete substantive disagreement

IMPORTANT: Return ONLY a JSON object with:
- score: a number between 0 and 1
- reasoning: a single string (one sentence)`, model);
}

/**
 * Helpfulness prediction — will this note be rated helpful?
 */
async function predictHelpfulness(
  noteText: string,
  tweetText: string,
  searchResults: string,
  url: string,
  model: string = DEFAULT_SCORING_MODEL
): Promise<NoteScore> {
  return scoreWithLLM("Helpfulness prediction", `Predict whether this Community Note will be rated as "Currently Rated Helpful" on X/Twitter.

Tweet being corrected:
"${tweetText}"

Community Note:
"${noteText}"

URL provided: ${url}

Research/Search Results that informed the note:
${searchResults}

Evaluate based on these criteria for helpful notes:
- Provides clear, factual correction with credible source
- Directly addresses the main claim in the tweet
- Concise and easy to understand
- Neutral tone without bias or judgment
- Source directly supports the correction
- Not overly pedantic or nitpicky

Scoring:
- 0.0-0.2: Poor note (vague, off-topic, biased, or unsupported)
- 0.2-0.4: Below average (some issues with clarity or relevance)
- 0.4-0.6: Average (decent but not compelling)
- 0.6-0.8: Good (clear, relevant, well-sourced)
- 0.8-1.0: Excellent (highly likely to be rated helpful)

IMPORTANT: Return ONLY a JSON object with:
- score: a number between 0 and 1
- reasoning: a brief explanation (one sentence)`, model);
}

/**
 * Source quality — LLM assessment of whether the linked source is credible
 * and appropriate for the specific claim being made. Replaces domain allowlists.
 */
async function checkSourceQuality(
  noteText: string,
  url: string,
  model: string = DEFAULT_SCORING_MODEL
): Promise<NoteScore> {
  return scoreWithLLM("Source quality", `A Community Note is being evaluated. Given the note's claim and the URL of its source, assess whether the source is credible and appropriate for the specific factual claim being made.

Community Note: "${noteText}"
Source URL: "${url}"

Consider:
- Is this source type appropriate for this kind of claim? (e.g. a YouTube video of an explosion is not appropriate for identifying a missile type; a Reuters article is appropriate for confirming a news event)
- Does the source appear to be from a reputable outlet, official body, or credible publication for this topic?
- Is this a primary source (official statement, official data) or secondary?
- Social media posts and YouTube videos can be valid sources when the note is about what was said/shown in them, but not for expert technical claims

Scoring:
- 0.0: Source is clearly inappropriate for the claim (YouTube video cited for expert technical claim, unknown blog)
- 0.3: Weak source — not well-matched to the specific claim
- 0.5: Acceptable source — credible enough but not ideal
- 0.7: Good source — reputable outlet appropriate for this type of claim
- 1.0: Excellent source — primary source or authoritative outlet that directly supports this exact claim

IMPORTANT: Return ONLY a JSON object with:
- score: a number between 0 and 1
- reasoning: a single sentence`, model);
}

/**
 * Breaking news risk — does the note make a present-tense negative claim
 * about a developing situation where facts could change within hours?
 */
async function checkBreakingNewsRisk(
  noteText: string,
  tweetText: string,
  model: string = DEFAULT_SCORING_MODEL
): Promise<NoteScore> {
  return scoreWithLLM("Breaking news risk", `A Community Note is being evaluated. Does it make a present-tense negative claim (e.g. "X has NOT happened", "X is NOT confirmed", "X is NOT dead") about what appears to be a breaking or rapidly developing situation? These notes are risky because by the time they are rated, the situation may have resolved and the note's claim become false.

Tweet: "${tweetText}"
Community Note: "${noteText}"

Scoring:
- 0.0: High risk — note makes a strong negative present-tense claim about something that appears to be fast-moving breaking news
- 0.3: Some risk — negative claim about a recent event but not clearly breaking
- 0.5: Moderate — note makes a correction but not clearly time-sensitive
- 0.7: Low risk — note corrects a stable historical fact or long-standing claim
- 1.0: No risk — note is about settled facts with no time-sensitive element

IMPORTANT: Return ONLY a JSON object with:
- score: a number between 0 and 1
- reasoning: a single sentence`, model);
}

/**
 * Pedantry — is the correction so minor it doesn't materially change
 * the main message of the tweet?
 */
async function checkPedantry(
  noteText: string,
  tweetText: string,
  model: string = DEFAULT_SCORING_MODEL
): Promise<NoteScore> {
  return scoreWithLLM("Pedantry", `A Community Note is being evaluated. Is the correction it makes trivially minor — a small numerical discrepancy, a pedantic label, or a secondary detail that doesn't materially change the main message or impact of the tweet?

Tweet: "${tweetText}"
Community Note: "${noteText}"

Scoring:
- 0.0: Extremely pedantic — corrects a rounding error, adjacent date, or minor label that leaves the tweet's main point entirely intact
- 0.3: Fairly minor — the correction is real but unlikely to change how readers understand the tweet
- 0.5: Moderate — the correction matters somewhat but isn't central
- 0.7: Substantive — the correction meaningfully changes how readers should interpret the tweet
- 1.0: The correction directly addresses the core misleading claim in the tweet

IMPORTANT: Return ONLY a JSON object with:
- score: a number between 0 and 1
- reasoning: a single sentence`, model);
}

/**
 * Note not needed — is the tweet opinion/satire rather than a checkable claim?
 */
async function checkNoteNotNeeded(
  noteText: string,
  tweetText: string,
  model: string = DEFAULT_SCORING_MODEL
): Promise<NoteScore> {
  return scoreWithLLM("Note not needed", `A Community Note is being evaluated. Does the original tweet actually make a verifiable factual claim that warrants correction, or is it opinion, satire, humor, or rhetorical — meaning a Community Note isn't really needed?

Tweet: "${tweetText}"
Community Note: "${noteText}"

Scoring:
- 0.0: No factual claim — tweet is clearly opinion, satire, humor, or rhetorical; note is not needed
- 0.3: Weak factual claim — tweet makes an implicit or borderline factual assertion
- 0.5: Ambiguous — could be interpreted as factual or opinion
- 0.7: Clear factual claim that could mislead readers
- 1.0: Explicit factual claim that is clearly false or misleading

IMPORTANT: Return ONLY a JSON object with:
- score: a number between 0 and 1
- reasoning: a single sentence`, model);
}

/**
 * Tangential correction — does the note correct a secondary detail while
 * the main misleading claim goes unaddressed?
 */
async function checkTangentialCorrection(
  noteText: string,
  tweetText: string,
  model: string = DEFAULT_SCORING_MODEL
): Promise<NoteScore> {
  return scoreWithLLM("Tangential correction", `A Community Note is being evaluated. Does it correct a tangential or secondary detail of the tweet, while the main misleading claim goes unaddressed? Or does it directly address what is actually misleading about the tweet?

Tweet: "${tweetText}"
Community Note: "${noteText}"

Scoring:
- 0.0: Highly tangential — corrects a side detail while the main misleading claim is untouched
- 0.3: Mostly tangential — the correction is real but misses the point of what's misleading
- 0.5: Partially on-point — addresses some but not the main misleading element
- 0.7: Mostly on-point — addresses the main claim, minor tangential elements
- 1.0: Directly addresses the core misleading claim in the tweet

IMPORTANT: Return ONLY a JSON object with:
- score: a number between 0 and 1
- reasoning: a single sentence`, model);
}

/**
 * Rater verifiability — can a typical non-expert rater check this claim
 * in a few minutes? Claims requiring specialist knowledge may get NH because
 * raters can't verify them.
 */
async function checkRaterVerifiability(
  noteText: string,
  tweetText: string,
  model: string = DEFAULT_SCORING_MODEL
): Promise<NoteScore> {
  return scoreWithLLM("Rater verifiability", `A Community Note is being evaluated. Can a typical person (non-expert) verify the note's factual claim themselves in a few minutes using a basic web search?

Tweet: "${tweetText}"
Community Note: "${noteText}"

Consider:
- Can the claim be checked with a simple Google search or by visiting the linked source?
- Does verifying the claim require specialist expertise (e.g. identifying missile types, medical diagnosis, legal interpretation)?
- Is the correction about a well-documented public fact (election result, sports score, official statement) vs an expert judgment?

Scoring:
- 0.0: Impossible to verify without specialist expertise — most raters would not be able to confirm or deny
- 0.3: Difficult — requires domain knowledge most people don't have
- 0.5: Moderate — verifiable but requires some effort or background knowledge
- 0.7: Easy — can be checked with a quick search
- 1.0: Trivially verifiable — the source directly confirms the claim, any rater can check instantly

IMPORTANT: Return ONLY a JSON object with:
- score: a number between 0 and 1
- reasoning: a single sentence`, model);
}

/**
 * Overconfidence — does the note state its claim with more certainty than
 * the evidence warrants?
 */
async function checkOverconfidence(
  noteText: string,
  model: string = DEFAULT_SCORING_MODEL
): Promise<NoteScore> {
  return scoreWithLLM("Overconfidence", `A Community Note is being evaluated. Does it state its claim with appropriate confidence, or does it assert things more definitively than the evidence warrants?

Community Note: "${noteText}"

Consider:
- Does the note say something is "false" or "wrong" when the evidence only shows it's "disputed" or "unconfirmed"?
- Does it present one source's view as settled fact?
- Does it make sweeping claims ("never happened", "completely false") when the truth is more nuanced?
- Conversely, is it appropriately confident when the facts are well-established?

Scoring:
- 0.0: Highly overconfident — states strong definitive claims that the evidence doesn't support
- 0.3: Somewhat overconfident — slightly overstates certainty
- 0.5: Appropriate confidence level for the evidence available
- 0.7: Well-calibrated — matches claim strength to evidence strength
- 1.0: Perfectly calibrated — appropriately hedged where needed, confident where warranted

IMPORTANT: Return ONLY a JSON object with:
- score: a number between 0 and 1
- reasoning: a single sentence`, model);
}

/**
 * Count URLs/sources in a note.
 */
export function countSources(noteText: string): number {
  const urlPattern = /https?:\/\/[^\s)]+/g;
  const matches = noteText.match(urlPattern);
  return matches ? matches.length : 0;
}

/**
 * Run all note scores in parallel.
 */
export async function runNoteScores(
  noteText: string,
  postText: string,
  searchResults: string,
  url: string,
  model: string = DEFAULT_SCORING_MODEL
): Promise<AllNoteScores> {
  const [
    positiveEvidence,
    disagreement,
    helpfulness,
    sourceQuality,
    breakingNewsRisk,
    pedantry,
    noteNotNeeded,
    tangentialCorrection,
    raterVerifiability,
    overconfidence,
  ] = await Promise.all([
    checkPositiveEvidence(noteText, model),
    checkSubstantiveDisagreement(noteText, postText, model),
    predictHelpfulness(noteText, postText, searchResults, url, model),
    checkSourceQuality(noteText, url, model),
    checkBreakingNewsRisk(noteText, postText, model),
    checkPedantry(noteText, postText, model),
    checkNoteNotNeeded(noteText, postText, model),
    checkTangentialCorrection(noteText, postText, model),
    checkRaterVerifiability(noteText, postText, model),
    checkOverconfidence(noteText, model),
  ]);

  const all = { positiveEvidence, disagreement, helpfulness, sourceQuality, breakingNewsRisk, pedantry, noteNotNeeded, tangentialCorrection, raterVerifiability, overconfidence };

  // Write scores to tweet log (includes LLM context/response/duration)
  const log = getTweetLog();
  for (const [key, s] of Object.entries(all)) {
    log?.set(`scores.${key}`, {
      score: s.score, reasoning: s.reasoning,
      context: s.llmContext, response: s.llmResponse, durationMs: s.llmDurationMs,
    });
  }

  return all;
}

/**
 * Apply a list of score filters. Returns the first failure, or null if all pass.
 */
export function applyScoreFilters(
  scores: AllNoteScores,
  filters: Array<{ score: keyof AllNoteScores; op: "gte" | "lte"; threshold: number }>,
): { failedFilter: string; reason: string } | null {
  for (const filter of filters) {
    const value = scores[filter.score].score;
    const passed = filter.op === "gte" ? value >= filter.threshold : value <= filter.threshold;
    if (!passed) {
      const opSymbol = filter.op === "gte" ? ">=" : "<=";
      return {
        failedFilter: filter.score,
        reason: `${filter.score} ${value.toFixed(2)} failed ${opSymbol} ${filter.threshold}`,
      };
    }
  }
  return null;
}
