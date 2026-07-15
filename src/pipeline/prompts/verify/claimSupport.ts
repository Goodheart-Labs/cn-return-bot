/**
 * Prompt — source verifier claim support (claim-based flow, call 2).
 *
 * Maps each extracted claim to the cited source URLs that support it. See
 * runClaimBasedVerification in src/pipeline/verify/sourceVerifier.ts.
 */

import { jsonSchemaResponseFormat } from "../responseFormat";
import { CITATIONS_PROMPT_FRAGMENT, EVALUATED_SOURCE_SCHEMA } from "./citations";

export function buildClaimSupportSystemPrompt(acceptsMediaSources: boolean, useCitations: boolean): string {
  const mediaRule = acceptsMediaSources
    ? `- Media URLs (videos, audio, images) appear with an automated content analysis block (title, summary, on-screen/visible text, transcript). Treat that block as the source's content. If it could not be analyzed you'll see the raw page or a fetch error instead.`
    : `- Video/audio URLs (YouTube, Vimeo, TikTok, Twitch, etc.) provide ZERO evidence — you cannot watch them, so never list them as supporting.`;

  const rules = `Rules:
- A source supports a claim only if its fetched content states or clearly implies that claim. If it doesn't, omit it for that claim.
- Twitter/X links come with the fetched tweet text and author; list one as supporting a claim only if that tweet text states or clearly implies the claim. A tweet marked "could not be fetched" supports a claim only when the claim is about that post itself.
- A source that failed to fetch ("Fetch failed:" / "Fetch error:" / "Non-text content:") supports nothing.
${mediaRule}

Scope — what to ignore:
- The original post and any "Research findings" are background, not sources. Only URLs under "Note's cited sources" may be listed.
- Sources marked "[from search snippet]" were not fully fetched; judge them from the available snippet.`;

  if (useCitations) {
    return `For each factual claim of a proposed community note, gather the cited sources relevant to it and judge whether each supports the claim.

${rules}

${CITATIONS_PROMPT_FRAGMENT}

Output JSON: { "reasoning": string, "claim_support": [{ "claim": string, "sources": [{ "url": string, "citations": [{ "quote": string, "explanation": string }], "verdict": "good"|"bad" }] }] }
- Include every claim, in the order given. List only the sources relevant to each claim — a source you omit counts as not supporting that claim. A source supports the claim iff its verdict is "good". Use the verbatim cited URLs.`;
  }

  return `For each factual claim of a proposed community note, list the cited source URLs whose content directly supports that claim.

${rules}

Output JSON: { "reasoning": string, "claim_support": [{ "claim": string, "supporting_sources": string[] }] }
- Include every claim, in the order given. Use the verbatim cited URLs. supporting_sources may be empty when nothing supports the claim.`;
}

export const CLAIM_SUPPORT_RESPONSE_FORMAT = jsonSchemaResponseFormat("claim_support", {
  type: "object",
  properties: {
    reasoning: { type: "string", description: "Brief note on which claims are unsupported, if any." },
    claim_support: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          supporting_sources: {
            type: "array",
            items: { type: "string" },
            description: "Verbatim cited URLs whose content directly supports this claim. May be empty.",
          },
        },
        required: ["claim", "supporting_sources"],
        additionalProperties: false,
      },
    },
  },
  required: ["reasoning", "claim_support"],
  additionalProperties: false,
});

/** Citations-mode claim-support schema: each claim carries an evaluated-source
 *  list (citations before verdict) instead of a bare URL list. A source is
 *  listed under a claim only when relevant; a source supports the claim iff its
 *  verdict is "good". */
export const CLAIM_SUPPORT_CITATIONS_RESPONSE_FORMAT = jsonSchemaResponseFormat("claim_support_cited", {
  type: "object",
  properties: {
    reasoning: { type: "string", description: "Brief note on which claims are unsupported, if any." },
    claim_support: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          sources: {
            type: "array",
            description:
              'Only the cited sources relevant to this claim; omit a source to mark it not-supporting. A source supports the claim iff its verdict is "good".',
            items: EVALUATED_SOURCE_SCHEMA,
          },
        },
        required: ["claim", "sources"],
        additionalProperties: false,
      },
    },
  },
  required: ["reasoning", "claim_support"],
  additionalProperties: false,
});
