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

/** Appended to the search prompt when `config.search_note_likely` is on
 *  (SIMPLE_BOT_NOTE_LIKELY_TEST). A prior that a note is probably needed, to push
 *  the agent to investigate hard rather than default to "no correction". The
 *  contradicting "## When NOT to set correction_needed" section is stripped in
 *  the same case (see stripWhenNotToCorrectSection). */
export const SEARCH_NOTE_LIKELY_INSTRUCTION = `

## Message from the developer
I believe that this tweet needs a correction. Please provide a correction and make sure to set correction_needed to true even if you are uncertain!`;

/** Removes the "## When NOT to set correction_needed = true" block (everything
 *  up to the next "## " heading). Used together with SEARCH_NOTE_LIKELY_INSTRUCTION:
 *  the "assume a correction is needed" prior directly contradicts that
 *  don't-correct guidance, so we drop it. No-op on prompts that lack the section
 *  (the terse variants). */
export function stripWhenNotToCorrectSection(prompt: string): string {
  return prompt.replace(/\n\n## When NOT to set correction_needed = true\n[\s\S]*?(?=\n\n## )/, "");
}

/** Podcast-transcript search prompt (config.search_podcast). The input is a
 *  claim drawn from a podcast/interview plus a short transcript excerpt — NOT an
 *  X post. The X prompts make the model treat the transcript as a quoted
 *  conversation and refuse to fact-check; naming the input as a transcript claim
 *  fixes that. Regular variant (search_note_likely off). */
export const SEARCH_SYSTEM_PROMPT_PODCAST = `You are a research agent that fact-checks claims made on podcasts and interviews. Use the web_search tool to find evidence.

## What you get
A single factual claim taken from a podcast or interview, plus a short transcript excerpt around it for context. The message shows them as:
  Text from Transcript: <excerpt>
  Claim: <the claim>
Judge whether the claim is factually correct.

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

/** "Find the error" podcast variant (search_podcast + search_note_likely on):
 *  assumes the claim is wrong and digs for the contradicting facts. Used for
 *  re-checking hand-picked claims; deliberately raises the FP rate. */
export const SEARCH_SYSTEM_PROMPT_PODCAST_NOTE_LIKELY = `You are a research agent that fact-checks claims made on podcasts and interviews. Use the web_search tool to find evidence.

## What you get
A single factual claim taken from a podcast or interview, plus a short transcript excerpt around it for context. The message shows them as:
  Text from Transcript: <excerpt>
  Claim: <the claim>

## Your task
This claim is probably incorrect. Investigate why: search for the specific facts, numbers, dates, or context that contradict it, and explain the error. Set correction_needed to true unless, after a real search, the claim turns out to be clearly correct.

## Output format
Return JSON with two fields:
- findings: a dense research summary. Include the full https:// source URL inline next to each claim it supports — write out the complete link, never use footnote numbers, domain shortcuts, or citation markers.
- correction_needed: true if the claim is incorrect or misleading.

## Sourcing rules
- Include what each source says that's relevant.`;

/** Picks the podcast search prompt. `noteLikely` (config.search_note_likely)
 *  selects the "find the error" variant over the neutral one. */
export function buildPodcastSearchPrompt(noteLikely: boolean): string {
  return noteLikely ? SEARCH_SYSTEM_PROMPT_PODCAST_NOTE_LIKELY : SEARCH_SYSTEM_PROMPT_PODCAST;
}

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
