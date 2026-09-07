/**
 * Prompt — simple-bot search agent.
 *
 * This prompt drives a research agent that investigates whether a post contains
 * a correctable factual error. Every search provider in searchDispatch uses the
 * same prompt. The misinfo pre-pass appends a ground-truth reference block to
 * it. See dispatchSearch in src/pipeline/simple-bot/searchDispatch.ts.
 */

import { jsonSchemaResponseFormat } from "../responseFormat";

// The anti-pedantic phrasing points the model at the post's main claim or
// argument and never at a minor side error. It won
// SIMPLE_BOT_ANTI_PEDANTIC_TEST and became the base prompt when that test closed
// on 2026-08-06.
export const SEARCH_SYSTEM_PROMPT = `You are a research agent for Community Notes fact-checking on X/Twitter.

Your job: investigate whether the post's main claim / argument is incorrect and would benefit from a community note. Use the web_search tool to find evidence.

## Output format
Return JSON with two fields:
- findings: a dense research summary. Include the full https:// source URL inline next to each claim it supports — write out the complete link, never use footnote numbers, domain shortcuts, or citation markers.
- correction_needed: true only if the post's main claim / argument is incorrect and would benefit from a community note.

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

/** Appended to the search prompt when `config.time_travel_prompt` is on, which
 *  is the TIME_TRAVEL_PROMPT_TEST arm. It makes the model score the correction
 *  against the moment the post was published rather than against now. A post
 *  that was right when it was written has not made a correctable error. The
 *  timestamps are already in the user message, added in issue #186, and this
 *  instruction only tells the model to use them. A backtest on 2026-07-28 over
 *  398 rated notes found that it flags 9 notes that raters had rated not
 *  helpful, against about 3 that raters had rated helpful. See
 *  docs/improvement-menu-2026-07-25.md, entry T2. */
export const SEARCH_TIME_TRAVEL_INSTRUCTION = `

## Timing — the time-travel test
The user message states the current date and when the post was published. Before setting correction_needed = true, ask: would this correction have been accurate and fair at the moment the post was published? A post that was right when written — a score mid-match, a record since broken, a deal not yet closed, a figure since revised — has not made a correctable error; later developments are not corrections. Do not set correction_needed = true when the claim was true (or reasonably believed) at the time the post was published and only later events made it outdated. When timing bears on the claim, note each source's publication date in the findings.`;

/** The search prompt for checking a single claim, used when
 *  `config.search_claim` is on. The input is a verbatim excerpt highlighted from
 *  a podcast, an interview or an article, plus the surrounding passage for
 *  context. It is not an X post and it is not a paraphrase. With the X prompts
 *  the model treats the excerpt as a quoted conversation and refuses to
 *  fact-check it. Naming the input as an extracted claim fixes that. The
 *  everything pipeline uses this prompt. */
export const SEARCH_SYSTEM_PROMPT_CLAIM = `You are a research agent that fact-checks claims made in podcasts, interviews, and articles. Use the web_search tool to find evidence.

## What you get
A verbatim excerpt highlighted from a podcast, interview, or article — the specific claim to check — plus the surrounding passage for context. The message shows them as:
  Highlighted claim from Transcript: <verbatim excerpt>   (or "Highlighted claim from Article:")
  Surrounding context: <surrounding passage>
Some claims rest on an image instead of (or in addition to) text. A claim with no highlighted text comes from an image; since one image can carry several claims, a "Claim: <restatement>" line then names the one to check — judge only that claim against the described image. Judge whether the claim is factually correct.

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

/** Appends the ground-truth article of the misinfo pre-pass to the search
 *  prompt. `referenceBlock` carries that article while a pre-pass is active, and
 *  is null in the regular pipeline. The anti-pedantic test closed on 2026-08-06
 *  with the "on" arm winning, so its prompt is now the base prompt and the
 *  switch between the two variants is gone. */
export function buildSearchSystemPrompt(params: {
  referenceBlock: string | null;
}): string {
  const base = SEARCH_SYSTEM_PROMPT;
  if (!params.referenceBlock) return base;
  return `${base}

A reference document on this post's topic is provided below. Treat it as ground truth and include its Source URL inline in the findings as a citation.

${params.referenceBlock}`;
}

// This is the strict OpenAI-style json_schema. Anthropic models accept it
// through OpenRouter.
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

// A JSON instruction written into the prompt itself, for the providers that
// cannot accept a response_format we would route to. OpenAI's web_search_preview
// rejects json_schema. For Perplexity Sonar no endpoint advertises support for
// json_schema or json_object, so provider.require_parameters makes the request
// come back as a 404.
export const SEARCH_PROMPTED_JSON_INSTRUCTION =
  "Respond with strict JSON only matching: { findings: string, correction_needed: boolean }";
