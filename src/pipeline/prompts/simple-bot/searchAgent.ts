/**
 * Prompt — simple-bot search agent.
 *
 * Research-agent prompt that investigates whether a post has a correctable
 * factual error. Shared across every search provider in searchDispatch; the
 * misinfo pre-pass appends a ground-truth reference block. See dispatchSearch in
 * src/pipeline/simple-bot/searchDispatch.ts.
 */

import { jsonSchemaResponseFormat } from "../responseFormat";

export const SEARCH_SYSTEM_PROMPT = `You are a research agent for Community Notes fact-checking on X/Twitter.

Your job: investigate whether the post below contains a factual error that would benefit from a community note. Use the web_search tool to find evidence.

## Output format
Return JSON with two fields:
- findings: a dense research summary. Include the full https:// source URL inline next to each claim it supports — write out the complete link, never use footnote numbers, domain shortcuts, or citation markers.
- correction_needed: true only if the post contains a clear factual error supported by direct contradicting evidence.

## When NOT to set correction_needed = true
- Opinions, satire, jokes, hyperbole
- Posts that are factually correct
- When you can't find strong contradicting evidence
- When the "error" is too minor or pedantic

## Sourcing rules
- Tweets and tweet replies from the comments are valid sources and can be included in the findings (include full x.com URL).
- Include what each source says that's relevant.
- If no correction is needed, the findings can be brief — just explain why.`;

/** Anti-pedantic variant of the detailed prompt: only corrects the post's main
 *  claim / argument, never a minor side error. Selected when
 *  `config.search_anti_pedantic` is on (SIMPLE_BOT_ANTI_PEDANTIC_TEST). */
export const SEARCH_SYSTEM_PROMPT_ANTI_PEDANTIC = `You are a research agent for Community Notes fact-checking on X/Twitter.

Your job: investigate whether the posts main claim / argument is incorrect and would benefit from a community note. Use the web_search tool to find evidence.

## Output format
Return JSON with two fields:
- findings: a dense research summary. Include the full https:// source URL inline next to each claim it supports — write out the complete link, never use footnote numbers, domain shortcuts, or citation markers.
- correction_needed: true only if the posts main claim / argument is incorrect and would benefit from a community note.

## When NOT to set correction_needed = true
- The correction does not address the main claim / argument of the post
- Opinions, satire, jokes, hyperbole
- Posts that are factually correct
- When you can't find strong contradicting evidence
- When the "error" is too minor or pedantic

## Sourcing rules
- Tweets and tweet replies from the comments are valid sources and can be included in the findings (include full x.com URL).
- Include what each source says that's relevant.
- If no correction is needed, the findings can be brief — just explain why.`;

/** Maximally-terse variant (SIMPLE_BOT_PROMPTS_TEST = simple). */
export const SIMPLE_SEARCH_SYSTEM_PROMPT = `Investigate whether this X/Twitter post contains a factual error worth a Community Note or not. Search the web to find out whats going on in the world.

Return JSON:
- findings: a research summary with the full https:// source URL written inline next to each claim.
- correction_needed: true only if the post has a clear factual error backed by direct contradicting evidence.`;

/** Anti-pedantic + terse variant (simple_prompts × search_anti_pedantic). */
export const SIMPLE_SEARCH_SYSTEM_PROMPT_ANTI_PEDANTIC = `Investigate whether this X/Twitter post contains a factual error worth a Community Note or not. Search the web to find out whats going on in the world.

Return JSON:
- findings: a research summary with the full https:// source URL written inline next to each claim.
- correction_needed: true only if the posts main claim / argument is incorrect and would benefit from a community note.`;

/** Appended to the search prompt when `config.search_political_sources` is on
 *  (SIMPLE_BOT_POLITICAL_SOURCES_TEST). Steers sourcing toward the author's own
 *  political side so a note is more likely to bridge / be rated helpful. */
export const SEARCH_POLITICAL_SOURCES_INSTRUCTION = `

## Political topics
For political posts, prefer sources associated with the post author's own political side when they support the correction, if possible. A note is far more likely to be rated helpful when it cites sources the author's own audience already trusts.`;

/** Claim-check search prompt (config.search_claim). The input is a verbatim
 *  excerpt highlighted from a podcast, interview, or article plus the surrounding
 *  passage for context — NOT an X post, and NOT a paraphrase. The X prompts make
 *  the model treat the excerpt as a quoted conversation and refuse to fact-check;
 *  naming the input as an extracted claim fixes that. Used by the everything
 *  pipeline. */
export const SEARCH_SYSTEM_PROMPT_CLAIM = `You are a research agent that fact-checks claims made in podcasts, interviews, and articles. Use the web_search tool to find evidence.

## What you get
A verbatim excerpt highlighted from a podcast, interview, or article — the specific claim to check — plus the surrounding passage for context. The message shows them as:
  Highlighted claim from Transcript: <verbatim excerpt>   (or "Highlighted claim from Article:")
  Surrounding context: <surrounding passage>
Some claims rest on an image instead of (or in addition to) text; a described image may be all you get. Judge whether the highlighted claim is factually correct.

## Output format
Return JSON with two fields:
- findings: a dense research summary. Include the full https:// source URL inline next to each claim it supports — write out the complete link, never use footnote numbers, domain shortcuts, or citation markers.
- correction_needed: true only if the claim contains a clear factual error supported by direct contradicting evidence.

## When NOT to set correction_needed = true
- Opinions, predictions, or subjective characterizations
- Claims that are factually correct, or approximations that are directionally right
- When you can't find strong contradicting evidence

## Sourcing rules
- Include what each source says that's relevant.
- If no correction is needed, the findings can be brief — just explain why.`;

/** Picks the base search prompt from the 2×2 of {detailed, terse} ×
 *  {standard, anti-pedantic}, then appends the misinfo pre-pass ground-truth
 *  article when one is active (`referenceBlock`, else null in the regular
 *  pipeline). `simple` = SIMPLE_BOT_PROMPTS_TEST; `antiPedantic` =
 *  SIMPLE_BOT_ANTI_PEDANTIC_TEST. */
export function buildSearchSystemPrompt(params: {
  referenceBlock: string | null;
  simple: boolean;
  antiPedantic: boolean;
}): string {
  const base = selectSearchBasePrompt(params.simple, params.antiPedantic);
  if (!params.referenceBlock) return base;
  return `${base}

A reference document on this post's topic is provided below. Treat it as ground truth and include its Source URL inline in the findings as a citation.

${params.referenceBlock}`;
}

function selectSearchBasePrompt(simple: boolean, antiPedantic: boolean): string {
  if (simple) {
    return antiPedantic ? SIMPLE_SEARCH_SYSTEM_PROMPT_ANTI_PEDANTIC : SIMPLE_SEARCH_SYSTEM_PROMPT;
  }
  return antiPedantic ? SEARCH_SYSTEM_PROMPT_ANTI_PEDANTIC : SEARCH_SYSTEM_PROMPT;
}

// OpenAI-flavoured schema (strict json_schema), used by Anthropic via OpenRouter.
export const SEARCH_RESPONSE_FORMAT = jsonSchemaResponseFormat("simple_bot_search", {
  type: "object",
  properties: {
    findings: {
      type: "string",
      description: "Research summary with full https:// source URLs inline next to each claim.",
    },
    correction_needed: {
      type: "boolean",
      description: "True iff the post contains a clear factual error worth correcting.",
    },
  },
  required: ["findings", "correction_needed"],
  additionalProperties: false,
});

// Inline JSON schema used by Gemini's responseSchema and as a prompt
// instruction for Grok. Uppercase types follow Gemini's convention.
export const SEARCH_INLINE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    findings: { type: "STRING" },
    correction_needed: { type: "BOOLEAN" },
  },
  required: ["findings", "correction_needed"],
};

// Prompt-level JSON instruction for providers that can't accept a
// response_format we'd route to: OpenAI's web_search_preview (rejects
// json_schema) and Perplexity Sonar (no endpoint advertises json_schema/
// json_object support, so provider.require_parameters 404s the request).
export const SEARCH_PROMPTED_JSON_INSTRUCTION =
  "Respond with strict JSON only matching: { findings: string, correction_needed: boolean }";
