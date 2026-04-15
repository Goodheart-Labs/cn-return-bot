/**
 * Deep Fact Verification
 *
 * Uses Opus to analyze claims in a tweet, build a "model of events",
 * and run targeted follow-up searches to verify specific claims.
 */

import { extractCitations, llm } from "../llm/llm";
import { getTweetLog, logLlmCall } from "../utils/tweetLog";

export interface ClaimAnalysis {
  keyClaims: Array<{
    claim: string;
    confidence: "high" | "medium" | "low";
    needsVerification: boolean;
  }>;
  modelOfEvents: string;
  targetedQueries: string[];
}

const CLAIM_ANALYSIS_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "claim_analysis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        keyClaims: {
          type: "array",
          items: {
            type: "object",
            properties: {
              claim: { type: "string" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              needsVerification: { type: "boolean" },
            },
            required: ["claim", "confidence", "needsVerification"],
            additionalProperties: false,
          },
        },
        modelOfEvents: { type: "string" },
        targetedQueries: { type: "array", items: { type: "string" } },
      },
      required: ["keyClaims", "modelOfEvents", "targetedQueries"],
      additionalProperties: false,
    },
  },
};

const VALIDATION_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "event_validation",
    strict: true,
    schema: {
      type: "object",
      properties: {
        isAccurate: { type: "boolean" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        issues: { type: "array", items: { type: "string" } },
        reasoning: { type: "string" },
      },
      required: ["isAccurate", "confidence", "issues", "reasoning"],
      additionalProperties: false,
    },
  },
};

export interface DeepVerificationResult {
  originalSearchResults: string;
  claimAnalysis: ClaimAnalysis;
  followUpSearchResults: string;
  combinedContext: string;
  allCitations: string[];
}

/**
 * Analyze claims in tweet using Opus to identify what needs verification
 */
async function analyzeClaimsWithOpus(
  tweetText: string,
  initialSearchResults: string,
  model: string = "anthropic/claude-opus-4.5"
): Promise<ClaimAnalysis> {
  const prompt = `You are analyzing a tweet and search results to identify claims that need fact-checking.

TWEET:
${tweetText}

INITIAL SEARCH RESULTS:
${initialSearchResults}

Your task:
1. Extract the KEY FACTUAL CLAIMS from the tweet (not opinions)
2. Build a "model of events" - what does the tweet claim happened?
3. Generate 1-2 targeted search queries to verify the most important claims

Focus on:
- Specific dates, numbers, quotes, statistics
- Claims that contradict what the search results say
- Verifiable factual assertions (not opinions or predictions)
- Claims where the search results are ambiguous or don't directly address

IMPORTANT:
- Only include 1-2 targeted queries maximum
- Make queries specific enough to find direct evidence
- If the initial search already thoroughly addresses all claims, return empty targetedQueries array`;

  try {
    const messages = [{ role: "user" as const, content: prompt }];
    const startMs = Date.now();
    const result = await llm.create({
      model,
      temperature: 0.2,
      response_format: CLAIM_ANALYSIS_RESPONSE_FORMAT,
      messages,
    });

    const content = result.choices?.[0]?.message?.content || "{}";
    logLlmCall("deepVerify.claimAnalysis", messages, content, Date.now() - startMs);
    return JSON.parse(content) as ClaimAnalysis;
  } catch (err: any) {
    console.error("[deepFactVerification] Claim analysis failed:", err.message);
    return {
      keyClaims: [],
      modelOfEvents: "",
      targetedQueries: [],
    };
  }
}

/**
 * Run a single follow-up search using Perplexity
 */
async function runFollowUpSearch(
  query: string,
  model: string = "perplexity/sonar"
): Promise<{ results: string; citations: string[] }> {
  try {
    const messages = [
      {
        role: "system" as const,
        content: `You are a fact-checking research assistant. Search for specific evidence about the query.
Include specific URLs for all sources. Focus on finding authoritative, primary sources.`,
      },
      { role: "user" as const, content: query },
    ];
    const startMs = Date.now();
    const result = await llm.create({ model, messages });

    const searchResults = result.choices?.[0]?.message?.content || "";
    logLlmCall(`deepVerify.followUp`, messages, searchResults, Date.now() - startMs);
    const citations = extractCitations(result);

    return { results: searchResults, citations };
  } catch (err: any) {
    console.error(`[deepFactVerification] Follow-up search failed for "${query}":`, err.message);
    return { results: "", citations: [] };
  }
}

/**
 * Run targeted follow-up searches based on claim analysis
 */
async function runFollowUpSearches(
  queries: string[],
  maxQueries: number = 2
): Promise<{ results: string; citations: string[] }> {
  if (queries.length === 0) {
    return { results: "", citations: [] };
  }

  const queriesToRun = queries.slice(0, maxQueries);

  // Run searches in parallel
  const searchPromises = queriesToRun.map((query) => runFollowUpSearch(query));
  const searchResults = await Promise.all(searchPromises);

  // Combine results
  const combinedResults: string[] = [];
  const allCitations: string[] = [];

  for (let i = 0; i < searchResults.length; i++) {
    const result = searchResults[i];
    if (result && result.results) {
      combinedResults.push(`=== FOLLOW-UP: ${queriesToRun[i]} ===\n${result.results}`);
      allCitations.push(...result.citations);
    }
  }

  return {
    results: combinedResults.join("\n\n"),
    citations: Array.from(new Set(allCitations)), // Dedupe
  };
}

/**
 * Validate the model of events against search results
 */
async function validateModelOfEvents(
  modelOfEvents: string,
  searchResults: string,
  model: string = "anthropic/claude-opus-4.5"
): Promise<{
  isAccurate: boolean;
  confidence: "high" | "medium" | "low";
  issues: string[];
  reasoning: string;
}> {
  if (!modelOfEvents) {
    return {
      isAccurate: true,
      confidence: "low",
      issues: [],
      reasoning: "No model of events to validate",
    };
  }

  const prompt = `Compare this "model of events" (what the tweet claims happened) against the search results.

MODEL OF EVENTS (from tweet):
${modelOfEvents}

SEARCH RESULTS:
${searchResults}

Determine:
1. Is this model of events accurate based on the evidence?
2. What specific issues or contradictions exist?
3. How confident are you in this assessment?

Determine whether the model of events is accurate based on the evidence.`;

  try {
    const messages = [{ role: "user" as const, content: prompt }];
    const startMs = Date.now();
    const result = await llm.create({
      model,
      temperature: 0.2,
      response_format: VALIDATION_RESPONSE_FORMAT,
      messages,
    });

    const content = result.choices?.[0]?.message?.content || "{}";
    logLlmCall("deepVerify.validate", messages, content, Date.now() - startMs);
    return JSON.parse(content);
  } catch (err: any) {
    console.error("[deepFactVerification] Model validation failed:", err.message);
    // Conservative: treat validation failure as potentially inaccurate
    return {
      isAccurate: false,
      confidence: "low",
      issues: ["Validation process failed"],
      reasoning: `Validation failed: ${err.message}`,
    };
  }
}

/**
 * Full deep verification pipeline
 */
export async function deepFactVerification(
  input: {
    text: string;
    media: string[];
    initialSearchResults: string;
    initialCitations: string[];
  },
  config?: {
    analysisModel?: string;
    searchModel?: string;
    maxFollowUpQueries?: number;
    validateModel?: boolean;
  }
): Promise<DeepVerificationResult> {
  const analysisModel = config?.analysisModel || "anthropic/claude-opus-4.5";
  const maxQueries = config?.maxFollowUpQueries ?? 2;
  const shouldValidate = config?.validateModel ?? true;

  // 1. Analyze claims
  const claimAnalysis = await analyzeClaimsWithOpus(
    input.text,
    input.initialSearchResults,
    analysisModel
  );

  // 2. Run follow-up searches if needed
  const followUp = await runFollowUpSearches(
    claimAnalysis.targetedQueries,
    maxQueries
  );

  // 3. Combine all context
  let combinedContext = input.initialSearchResults;
  if (followUp.results) {
    combinedContext += "\n\n--- FOLLOW-UP VERIFICATION RESEARCH ---\n\n" + followUp.results;
  }

  // 4. Optionally validate the model of events
  if (shouldValidate && claimAnalysis.modelOfEvents) {
    const validation = await validateModelOfEvents(
      claimAnalysis.modelOfEvents,
      combinedContext,
      analysisModel
    );

    if (!validation.isAccurate && validation.issues.length > 0) {
      combinedContext += "\n\n--- MODEL OF EVENTS VALIDATION ---\n";
      combinedContext += `The tweet's narrative appears ${validation.isAccurate ? "accurate" : "inaccurate"}.\n`;
      combinedContext += `Issues found: ${validation.issues.join("; ")}\n`;
      combinedContext += `Assessment: ${validation.reasoning}`;
    }
  }

  // Combine citations
  const allCitations = [
    ...new Set([...input.initialCitations, ...followUp.citations]),
  ];

  // Write to tweet log
  const log = getTweetLog();
  log?.set("deepVerification.claims", claimAnalysis.keyClaims);
  log?.set("deepVerification.modelOfEvents", claimAnalysis.modelOfEvents);
  log?.set("deepVerification.queries", claimAnalysis.targetedQueries);
  log?.set("deepVerification.followUpResults", followUp.results);
  log?.set("deepVerification.followUpCitations", followUp.citations);
  log?.set("deepVerification.totalCitations", allCitations.length);

  return {
    originalSearchResults: input.initialSearchResults,
    claimAnalysis,
    followUpSearchResults: followUp.results,
    combinedContext,
    allCitations,
  };
}
