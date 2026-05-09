/**
 * Source Verifier
 *
 * Single LLM call that checks whether cited sources actually support a community note.
 * Fetches source content, then asks the model to accept or reject.
 */

import { handleWebFetch } from "../tool-calling/tools";
import { getBotConfig } from "../ab-testing/botConfig";
import { trackedLlmCreate, trackLlmCall } from "../cost-tracking/costTracker";
import { getTweetLog } from "../utils/tweetLog";
import { UnfetchableSourcesError, ModelOutputInvalidError } from "../utils/errors";

export interface SourceVerification {
  accepted: boolean;
  reasoning: string;
}

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "source_verification",
    strict: true,
    schema: {
      type: "object",
      properties: {
        accepted: { type: "boolean", description: "Whether the sources support the note's correction." },
        reasoning: { type: "string", description: "Why the note was accepted or rejected." },
      },
      required: ["accepted", "reasoning"],
      additionalProperties: false,
    },
  },
};

function isTwitterUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "x.com" || hostname.endsWith(".x.com") ||
           hostname === "twitter.com" || hostname.endsWith(".twitter.com");
  } catch {
    return false;
  }
}

interface FetchedSource {
  url: string;
  content: string;
  fetched: boolean;
}

async function fetchSourceContent(sources: string[]): Promise<{ sections: string; fetchedCount: number; totalNonTwitter: number }> {
  const results: FetchedSource[] = [];

  for (const url of sources) {
    if (isTwitterUrl(url)) {
      results.push({ url, content: "Twitter/X link — accepted without fetching.", fetched: true });
      continue;
    }
    const result = await handleWebFetch(url);
    const content = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
    const isFetchError = content.startsWith("Fetch failed:") || content.startsWith("Fetch error:") || content.startsWith("Non-text content:");
    results.push({ url, content, fetched: !isFetchError });
  }

  const sections = results.map((r) => `### ${r.url}\n${r.content}`).join("\n\n");
  const nonTwitter = results.filter((r) => !isTwitterUrl(r.url));
  const fetchedCount = nonTwitter.filter((r) => r.fetched).length;

  return { sections, fetchedCount, totalNonTwitter: nonTwitter.length };
}

const SYSTEM_PROMPT = `You verify whether the sources cited by a proposed community note support the correction made in that note.

Your ONLY job: do the URLs listed under "Note's cited sources", as fetched, support the factual claims in the note?

Scope — what to ignore:
- Media, links, or videos embedded in the original post are NOT note sources. The post is shown only so you understand what the note is correcting. Do not evaluate whether the post's evidence is valid.
- The "Research findings" section is background reasoning from an earlier pipeline step, not a source. Treat a URL there as a source only if it also appears under "Note's cited sources".

Decision rules for the note's cited sources:
- Twitter/X links (x.com, twitter.com) are accepted as valid without content checks.
- Any other source must (a) have been successfully fetched and (b) directly support a factual claim in the note. A source that failed to fetch provides ZERO evidence.
- Video/audio URLs (YouTube, Vimeo, TikTok, Twitch, etc.) cited as sources provide ZERO evidence — you cannot watch them.

Set accepted=true if every factual claim in the note is supported by at least one valid cited source. Otherwise set accepted=false and name the unsupported claim in your reasoning.`;

export async function verifySources(params: {
  noteText: string;
  sources: string[];
  postContext: string;
  researcherFindings: string;
  turnNumber: number;
}): Promise<SourceVerification> {
  const log = getTweetLog();
  const config = getBotConfig();
  const logPrefix = `sourceVerifier.turn.${params.turnNumber}.messages`;

  const { sections, fetchedCount, totalNonTwitter } = await fetchSourceContent(params.sources);

  const userMessage = [
    `## Context`,
    `Current date (UTC): ${new Date().toISOString()}`,
    ``,
    `## Proposed community note`,
    params.noteText,
    ``,
    `## Note's cited sources (verify these)`,
    sections,
    ``,
    `## Original post (background — not a source)`,
    params.postContext,
    ``,
    `## Research findings (background — not a source)`,
    params.researcherFindings,
  ].join("\n");

  log?.set(`${logPrefix}.0`, { systemPrompt: SYSTEM_PROMPT, userMessage });

  if (totalNonTwitter > 0 && fetchedCount === 0) {
    throw new UnfetchableSourcesError(
      `None of the ${totalNonTwitter} non-Twitter source(s) could be fetched`,
    );
  }

  const { response, costEntry } = await trackedLlmCreate(`sourceVerifier.turn.${params.turnNumber}`, {
    model: config.verifier_model ?? config.model,
    messages: [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: userMessage },
    ],
    response_format: RESPONSE_FORMAT,
  } as any);
  trackLlmCall(costEntry);

  const content = response.choices?.[0]?.message?.content ?? "{}";
  let result: SourceVerification;
  try {
    result = JSON.parse(content);
  } catch {
    throw new ModelOutputInvalidError(
      `sourceVerifier.turn.${params.turnNumber}: model output was not valid JSON. content="${content.slice(0, 200)}"`,
    );
  }

  log?.set(`${logPrefix}.1`, { content: result });
  return result;
}
