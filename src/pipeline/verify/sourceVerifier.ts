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
import { describeVideoFromUrl, type VideoSourceDescription } from "../media/mediaAnalysisGemini";

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

// Hosts where we attempt a yt-dlp video download before falling back to
// handleWebFetch. Includes hosts that are not exclusively video (facebook,
// instagram) — yt-dlp decides; failures fall through to the web-fetch path.
const YT_DLP_HOSTS = [
  "youtube.com", "youtu.be",
  "vimeo.com",
  "tiktok.com",
  "twitch.tv",
  "facebook.com", "fb.watch",
  "instagram.com",
  "dailymotion.com",
  "rumble.com",
];

function isYtDlpCandidate(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return YT_DLP_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const PLATFORM_DESCRIPTION_MAX_CHARS = 1500;

function formatVideoSection(url: string, video: VideoSourceDescription): string {
  const { meta, analysis } = video;
  const publishedIso = meta.timestamp ? new Date(meta.timestamp * 1000).toISOString() : null;
  const platformDesc = meta.description?.slice(0, PLATFORM_DESCRIPTION_MAX_CHARS);

  const lines = [
    `### ${url}`,
    `Automated video analysis (yt-dlp + Gemini). Treat this as the source's content.`,
    meta.title ? `Title: ${meta.title}` : null,
    meta.uploader ? `Uploader: ${meta.uploader}` : null,
    publishedIso ? `Published: ${publishedIso}` : null,
    platformDesc ? `Uploader-provided description:\n${platformDesc}` : null,
    `Content summary: ${analysis.description.description || "(empty)"}`,
    analysis.description.ocrText ? `On-screen text: ${analysis.description.ocrText}` : null,
    `Audio transcript: ${analysis.transcription || "(unavailable)"}`,
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}

interface FetchedSource {
  url: string;
  content: string;
  fetched: boolean;
}

async function fetchSourceContent(
  sources: string[],
  costPrefix: string,
  acceptVideoSources: boolean,
): Promise<{ sections: string; fetchedCount: number; totalNonFreebie: number }> {
  const results: FetchedSource[] = [];
  let videoIdx = 0;

  for (const url of sources) {
    if (isTwitterUrl(url)) {
      results.push({ url, content: `### ${url}\nTwitter/X link — accepted without fetching.`, fetched: true });
      continue;
    }
    if (acceptVideoSources && isYtDlpCandidate(url)) {
      try {
        const video = await describeVideoFromUrl(url, `${costPrefix}.video.${videoIdx++}`);
        results.push({ url, content: formatVideoSection(url, video), fetched: true });
        continue;
      } catch (err: any) {
        // yt-dlp failed (private video, removed, or URL isn't actually a video
        // page). Fall through to handleWebFetch so a text-only page still has a
        // chance of providing evidence.
        getTweetLog()?.set(`${costPrefix}.video.${videoIdx - 1}.ytdlp_error`, err?.message ?? "unknown error");
      }
    }
    const result = await handleWebFetch(url);
    const content = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
    const isFetchError = content.startsWith("Fetch failed:") || content.startsWith("Fetch error:") || content.startsWith("Non-text content:");
    results.push({ url, content: `### ${url}\n${content}`, fetched: !isFetchError });
  }

  const sections = results.map((r) => r.content).join("\n\n");
  const nonFreebie = results.filter((r) => !isTwitterUrl(r.url));
  const fetchedCount = nonFreebie.filter((r) => r.fetched).length;

  return { sections, fetchedCount, totalNonFreebie: nonFreebie.length };
}

function buildSystemPrompt(acceptsVideoSources: boolean): string {
  const videoRule = acceptsVideoSources
    ? `- Video/audio URLs (YouTube, Vimeo, TikTok, Twitch, Facebook, Instagram, etc.) may be presented with an automated content analysis block (title, uploader, content summary, on-screen text, audio transcript). When present, treat that block as the source's content and evaluate it like any other fetched source. If the URL could not be downloaded as a video, you'll see the raw web page instead (or a fetch error).`
    : `- Video/audio URLs (YouTube, Vimeo, TikTok, Twitch, etc.) cited as sources provide ZERO evidence — you cannot watch them.`;

  return `You verify whether the sources cited by a proposed community note support the correction made in that note.

Your ONLY job: do the URLs listed under "Note's cited sources", as fetched, support the factual claims in the note?

Scope — what to ignore:
- Media, links, or videos embedded in the original post are NOT note sources. The post is shown only so you understand what the note is correcting. Do not evaluate whether the post's evidence is valid.
- The "Research findings" section is background reasoning from an earlier pipeline step, not a source. Treat a URL there as a source only if it also appears under "Note's cited sources".

Decision rules for the note's cited sources:
- Twitter/X links (x.com, twitter.com) are accepted as valid without content checks.
- Any other source must (a) have been successfully fetched and (b) directly support a factual claim in the note. A source that failed to fetch provides ZERO evidence.
${videoRule}

Set accepted=true if every factual claim in the note is supported by at least one valid cited source. Otherwise set accepted=false and name the unsupported claim in your reasoning.`;
}

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

  const acceptVideoSources = config.verifier_accepts_video_sources ?? false;
  const { sections, fetchedCount, totalNonFreebie } = await fetchSourceContent(
    params.sources,
    `sourceVerifier.turn.${params.turnNumber}`,
    acceptVideoSources,
  );
  const systemPrompt = buildSystemPrompt(acceptVideoSources);

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

  log?.set(`${logPrefix}.0`, { systemPrompt: systemPrompt, userMessage });

  if (totalNonFreebie > 0 && fetchedCount === 0) {
    throw new UnfetchableSourcesError(
      `None of the ${totalNonFreebie} non-Twitter source(s) could be fetched`,
    );
  }

  const { response, costEntry } = await trackedLlmCreate(`sourceVerifier.turn.${params.turnNumber}`, {
    model: config.verifier_model ?? config.model,
    messages: [
      { role: "system" as const, content: systemPrompt },
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
