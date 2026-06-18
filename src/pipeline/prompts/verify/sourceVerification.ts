/**
 * Prompt — source verifier (classic flow).
 *
 * Verifies whether a note's cited sources support its claims and categorizes
 * each source good/bad. See runClassicVerification in
 * src/pipeline/verify/sourceVerifier.ts.
 */

import { jsonSchemaResponseFormat } from "../responseFormat";

export function buildVerifierSystemPrompt(acceptsMediaSources: boolean): string {
  const mediaRule = acceptsMediaSources
    ? `- Media URLs (videos, audio, images) may be presented with an automated content analysis block. For videos: title, uploader, content summary, on-screen text, audio transcript. For images: description and visible text. When present, treat that block as the source's content and evaluate it like any other fetched source. If the URL could not be analyzed as media, you'll see the raw web page instead (or a fetch error).`
    : `- Video/audio URLs (YouTube, Vimeo, TikTok, Twitch, etc.) cited as sources provide ZERO evidence — you cannot watch them.`;

  return `You verify whether the sources cited by a proposed community note support the claim made in that note, AND categorize each cited source as good or bad so the orchestrator can drop the bad ones from the final note.

Scope — what to ignore:
- Media, links, or videos embedded in the original post are NOT note sources. The post is shown only so you understand what the note is correcting. Do not evaluate whether the post's evidence is valid.
- If a "Research findings" section is present, it is background reasoning from an earlier pipeline step, not a source. Treat a URL there as a source only if it also appears under "Note's cited sources".
- Sources marked "[from search snippet]" were not fully fetched; evaluate them based on the available title and snippet text.

Classification rules for each cited source:
- Twitter/X links (x.com, twitter.com): the tweet's text and author are fetched and shown. Good only if that tweet content directly supports a factual claim in the note; otherwise bad. If a tweet is marked "could not be fetched", accept it as good — we can't read it, so don't penalize it.
- Any other source → good only if it (a) was successfully fetched (no "Fetch failed:" / "Fetch error:" / "Non-text content:" marker) AND (b) its content directly supports at least one factual claim in the note. Otherwise bad.
${mediaRule}

Output:
- good_sources: verbatim URLs (exactly as listed) that pass the rules above.
- bad_sources: every other cited URL — failed-to-fetch, irrelevant, or contradicts the note.
- Every cited URL must appear in exactly one of good_sources or bad_sources. Do not invent URLs.
- accepted: true iff good_sources together cover every factual claim in the note. Otherwise false, and name the unsupported claim in reasoning.`;
}

export const VERIFY_RESPONSE_FORMAT = jsonSchemaResponseFormat("source_verification", {
  type: "object",
  properties: {
    reasoning: { type: "string", description: "Why the note was accepted or rejected, and a short note on any bad_sources." },
    good_sources: {
      type: "array",
      items: { type: "string" },
      description: "Verbatim URLs from the cited sources that support a factual claim in the note. Twitter/X links come with the fetched tweet text — judge them on that content like any other source.",
    },
    bad_sources: {
      type: "array",
      items: { type: "string" },
      description: "Verbatim URLs from the cited sources that failed to fetch or that do not support any factual claim in the note.",
    },
    accepted: { type: "boolean", description: "True iff good_sources together cover every factual claim in the note." },
  },
  required: ["reasoning", "good_sources", "bad_sources", "accepted"],
  additionalProperties: false,
});
