/**
 * Scoring Filters
 *
 * LLM-based scoring filters that evaluate notes before posting.
 * Ported from community-notes-writer repo with same scoring patterns.
 */

import { llm } from "./llm";

export interface FilterScore {
  name: string;
  score: number; // 0-1 decimal
  passed: boolean; // score > 0.5
  reasoning: string;
}

export interface AllFilterScores {
  positive: FilterScore;
  disagreement: FilterScore;
  helpfulness: FilterScore;
}

/** Default model for scoring filters */
const DEFAULT_SCORING_MODEL = "anthropic/claude-sonnet-4";

/**
 * Positive claims filter - checks if note uses positive framing
 * (says what DID happen rather than what DIDN'T happen)
 */
export async function checkPositiveClaims(
  noteText: string,
  model: string = DEFAULT_SCORING_MODEL
): Promise<FilterScore> {
  const prompt = `Evaluate if this Community Note uses positive framing (says only what DID happen) rather than any negative claims (what DIDN'T happen).

Note to evaluate: "${noteText}"

Consider:
- Does it say someone DIDN'T say or do something at all (negative claim)
- Does it say someone DIDN'T do something at all (negative claim)
- Does it focus on what actually happened? (positive claim)
- If it references a specific fact-check backing up a negative claim, that's more acceptable
- A claim that something something else happened is not a negative claim. If they ducks flew away, that's a positive claim. There were no ducks is a negative claim.

Scoring:
- 0.0: Any negative claims ("This didn't happen", "They never said")
- 0.3: One or more ambiguous claims "This might have happened"
- 0.5: Unclear if all claims are positive
- 0.7: All positive claims
- 1.0: Unambiguously positive claims only

IMPORTANT: Return ONLY a JSON object with:
- score: a number between 0 and 1
- reasoning: a single string (one sentence)`;

  try {
    const result = await llm.create({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });

    const content = result.choices?.[0]?.message?.content || "{}";

    let parsed: { score?: number; reasoning?: string };
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error("[scoringFilters] JSON parse error in positive claims filter:", parseError);
      console.error("[scoringFilters] Raw content:", content);
      return {
        name: "Positive claims filter",
        score: 0,
        passed: false,
        reasoning: "Failed to parse LLM response as JSON",
      };
    }

    return {
      name: "Positive claims filter",
      score: parsed.score ?? 0.5,
      passed: (parsed.score ?? 0.5) > 0.5,
      reasoning: parsed.reasoning ?? "Could not parse reasoning",
    };
  } catch (error) {
    console.error("[scoringFilters] Error in positive claims filter:", error);
    return {
      name: "Positive claims filter",
      score: 0,
      passed: false,
      reasoning: "Error in filter, failing safely",
    };
  }
}

/**
 * Substantive disagreement filter - checks if note truly disagrees with the post
 */
export async function checkSubstantiveDisagreement(
  noteText: string,
  postText: string,
  model: string = DEFAULT_SCORING_MODEL
): Promise<FilterScore> {
  const prompt = `Evaluate if the Community Note substantively disagrees with the original post.

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
- reasoning: a single string (one sentence)`;

  try {
    const result = await llm.create({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });

    const content = result.choices?.[0]?.message?.content || "{}";

    let parsed: { score?: number; reasoning?: string };
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error("[scoringFilters] JSON parse error in disagreement filter:", parseError);
      console.error("[scoringFilters] Raw content:", content);
      return {
        name: "Substantive disagreement filter",
        score: 0,
        passed: false,
        reasoning: "Failed to parse LLM response as JSON",
      };
    }

    return {
      name: "Substantive disagreement filter",
      score: parsed.score ?? 0.5,
      passed: (parsed.score ?? 0.5) > 0.5,
      reasoning: parsed.reasoning ?? "Could not parse reasoning",
    };
  } catch (error) {
    console.error("[scoringFilters] Error in disagreement filter:", error);
    return {
      name: "Substantive disagreement filter",
      score: 0,
      passed: false,
      reasoning: "Error in filter, failing safely",
    };
  }
}

/**
 * Helpfulness prediction - predicts if note will be rated helpful
 */
export async function predictHelpfulness(
  noteText: string,
  tweetText: string,
  searchResults: string,
  url: string,
  model: string = DEFAULT_SCORING_MODEL
): Promise<FilterScore> {
  const prompt = `Predict whether this Community Note will be rated as "Currently Rated Helpful" on X/Twitter.

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
- reasoning: a brief explanation (one sentence)`;

  try {
    const result = await llm.create({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });

    const content = result.choices?.[0]?.message?.content || "{}";

    let parsed: { score?: number; reasoning?: string };
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error("[scoringFilters] JSON parse error in helpfulness filter:", parseError);
      console.error("[scoringFilters] Raw content:", content);
      return {
        name: "Helpfulness prediction",
        score: 0,
        passed: false,
        reasoning: "Failed to parse LLM response as JSON",
      };
    }

    return {
      name: "Helpfulness prediction",
      score: parsed.score ?? 0.5,
      passed: (parsed.score ?? 0.5) > 0.5,
      reasoning: parsed.reasoning ?? "Could not parse reasoning",
    };
  } catch (error) {
    console.error("[scoringFilters] Error in helpfulness filter:", error);
    return {
      name: "Helpfulness prediction",
      score: 0,
      passed: false,
      reasoning: "Error in filter, failing safely",
    };
  }
}

/**
 * Run all scoring filters in parallel
 */
export async function runScoringFilters(
  noteText: string,
  postText: string,
  searchResults: string,
  url: string,
  model: string = DEFAULT_SCORING_MODEL
): Promise<AllFilterScores> {
  console.log("[scoringFilters] Running scoring filters...");

  // Run filters in parallel for speed
  const [positive, disagreement, helpfulness] = await Promise.all([
    checkPositiveClaims(noteText, model),
    checkSubstantiveDisagreement(noteText, postText, model),
    predictHelpfulness(noteText, postText, searchResults, url, model),
  ]);

  // Log results
  console.log(
    `[Filter: ${positive.name}] Score: ${positive.score.toFixed(2)} - ${positive.passed ? "PASS" : "FAIL"}`
  );
  console.log(
    `[Filter: ${disagreement.name}] Score: ${disagreement.score.toFixed(2)} - ${disagreement.passed ? "PASS" : "FAIL"}`
  );
  console.log(
    `[Filter: ${helpfulness.name}] Score: ${helpfulness.score.toFixed(2)} - ${helpfulness.passed ? "PASS" : "FAIL"}`
  );

  return {
    positive,
    disagreement,
    helpfulness,
  };
}

/**
 * Check if all filters pass their thresholds
 */
export function checkAllThresholds(
  scores: AllFilterScores,
  thresholds = { positive: 0.5, disagreement: 0.5, helpfulness: 0.5 }
): boolean {
  return (
    scores.positive.score > thresholds.positive &&
    scores.disagreement.score > thresholds.disagreement &&
    scores.helpfulness.score > thresholds.helpfulness
  );
}
