/**
 * Source Verifier
 *
 * Single LLM call that checks whether cited sources actually support a community note.
 * Fetches source content, then asks the model to accept or reject.
 */

import { handleWebFetch } from "../tool-calling/tools";
import { getBotConfig } from "../utils/botConfig";
import { trackedLlmCreate, trackLlmCall } from "../utils/costTracker";
import { getTweetLog } from "../utils/tweetLog";

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

const SYSTEM_PROMPT = `You are a source verification step in a Community Notes pipeline. You receive a proposed community note, the sources it cites, the fetched content of those sources, and the original research findings.

Determine whether the cited sources actually support the correction made in the note.

Rules:
- All non-Twitter sources must be successfully fetched AND directly support the factual claim.
- Twitter/X links are accepted as valid sources without content verification.
- If a source failed to fetch, it provides ZERO evidence. Do not assume it supports the claim based on the URL alone.`;

export async function verifySources(params: {
  noteText: string;
  sources: string[];
  postText: string;
  postCreatedAt?: string;
  authorName?: string;
  researcherFindings: string;
  turnNumber: number;
}): Promise<SourceVerification> {
  const log = getTweetLog();
  const config = getBotConfig();
  const logPrefix = `sourceVerifier.turn.${params.turnNumber}.messages`;

  const { sections, fetchedCount, totalNonTwitter } = await fetchSourceContent(params.sources);

  const postHeader = [
    params.authorName ? `Author: ${params.authorName}` : null,
    params.postCreatedAt ? `Posted at: ${params.postCreatedAt}` : null,
  ].filter(Boolean).join("\n");

  const userMessage = [
    `## Context`,
    `Current date (UTC): ${new Date().toISOString()}`,
    ``,
    `## Original post`,
    postHeader,
    postHeader ? `` : null,
    params.postText,
    ``,
    `## Research findings`,
    params.researcherFindings,
    ``,
    `## Proposed community note`,
    params.noteText,
    ``,
    `## Source content`,
    sections,
  ].filter((line) => line !== null).join("\n");

  log?.set(`${logPrefix}.0`, { systemPrompt: SYSTEM_PROMPT, userMessage });

  // Fast reject: if there are non-Twitter sources but none could be fetched, no point calling the LLM
  if (totalNonTwitter > 0 && fetchedCount === 0) {
    const result: SourceVerification = {
      accepted: false,
      reasoning: `None of the ${totalNonTwitter} non-Twitter source(s) could be fetched. Cannot verify the note's claims without accessible sources.`,
    };
    log?.set(`${logPrefix}.1`, { content: result });
    return result;
  }

  try {
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
    const result: SourceVerification = JSON.parse(content);

    log?.set(`${logPrefix}.1`, { content: result });
    return result;
  } catch (err: any) {
    const fallback: SourceVerification = { accepted: false, reasoning: `Source verification failed: ${err.message}` };
    log?.set(`${logPrefix}.1`, { content: fallback });
    return fallback;
  }
}
