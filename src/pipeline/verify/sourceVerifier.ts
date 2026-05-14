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
import {
  describeMediaFromUrl,
  describeImageFromUrl,
  type MediaSourceDescription,
  type GeminiMediaItem,
} from "../media/mediaAnalysisGemini";

export interface SourceVerification {
  /** Cited URLs that support at least one factual claim in the note. Subset of the input sources. */
  good_sources: string[];
  /** Cited URLs that failed to fetch or don't support any factual claim. Subset of the input sources. */
  bad_sources: string[];
  /** True iff good_sources together cover every factual claim. */
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
        good_sources: {
          type: "array",
          items: { type: "string" },
          description: "Verbatim URLs from the cited sources that support a factual claim in the note. Twitter/X links are always good if they appear in the cited sources.",
        },
        bad_sources: {
          type: "array",
          items: { type: "string" },
          description: "Verbatim URLs from the cited sources that failed to fetch or that do not support any factual claim in the note.",
        },
        accepted: { type: "boolean", description: "True iff good_sources together cover every factual claim in the note." },
        reasoning: { type: "string", description: "Why the note was accepted or rejected, and a short note on any bad_sources." },
      },
      required: ["good_sources", "bad_sources", "accepted", "reasoning"],
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

// Hosts where we hand the URL to yt-dlp before falling back to handleWebFetch.
// yt-dlp decides whether the post is a video, an image, or unsupported;
// unsupported URLs (e.g. a text-only Facebook post) fall through to web-fetch.
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

const DIRECT_IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".avif"];

function isDirectImageUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return DIRECT_IMAGE_EXTS.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

const PLATFORM_DESCRIPTION_MAX_CHARS = 1500;

function formatYtDlpMediaSection(url: string, media: MediaSourceDescription): string {
  const { kind, meta, analysis } = media;
  const publishedIso = meta.timestamp ? new Date(meta.timestamp * 1000).toISOString() : null;
  const platformDesc = meta.description?.slice(0, PLATFORM_DESCRIPTION_MAX_CHARS);
  const header = kind === "video"
    ? `Automated video analysis (yt-dlp + Gemini). Treat this as the source's content.`
    : `Automated image analysis (yt-dlp + Gemini) — this URL is an image post, not a video. Treat this as the source's content.`;

  const lines = [
    `### ${url}`,
    header,
    meta.title ? `Title: ${meta.title}` : null,
    meta.uploader ? `Uploader: ${meta.uploader}` : null,
    publishedIso ? `Published: ${publishedIso}` : null,
    platformDesc ? `Uploader-provided description:\n${platformDesc}` : null,
    `Content summary: ${analysis.description.description || "(empty)"}`,
    analysis.description.ocrText ? (kind === "video" ? `On-screen text: ${analysis.description.ocrText}` : `Visible text: ${analysis.description.ocrText}`) : null,
    kind === "video" ? `Audio transcript: ${analysis.transcription || "(unavailable)"}` : null,
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}

function formatDirectImageSection(url: string, item: GeminiMediaItem): string {
  const lines = [
    `### ${url}`,
    `Automated image analysis (Gemini). Treat this as the source's content.`,
    `Image description: ${item.description.description || "(empty)"}`,
    item.description.ocrText ? `Visible text: ${item.description.ocrText}` : null,
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
  acceptMediaSources: boolean,
): Promise<{ sections: string; fetchedCount: number; totalNonFreebie: number }> {
  const results: FetchedSource[] = [];
  let mediaIdx = 0;

  for (const url of sources) {
    if (isTwitterUrl(url)) {
      results.push({ url, content: `### ${url}\nTwitter/X link — accepted without fetching.`, fetched: true });
      continue;
    }
    if (acceptMediaSources && isDirectImageUrl(url)) {
      try {
        const item = await describeImageFromUrl(url, `${costPrefix}.media.${mediaIdx++}`);
        results.push({ url, content: formatDirectImageSection(url, item), fetched: true });
        continue;
      } catch (err: any) {
        getTweetLog()?.set(`${costPrefix}.media.${mediaIdx - 1}.image_error`, err?.message ?? "unknown error");
      }
    } else if (acceptMediaSources && isYtDlpCandidate(url)) {
      try {
        const media = await describeMediaFromUrl(url, `${costPrefix}.media.${mediaIdx++}`);
        results.push({ url, content: formatYtDlpMediaSection(url, media), fetched: true });
        continue;
      } catch (err: any) {
        // yt-dlp couldn't handle this URL (text-only post, removed content,
        // private account). Fall through to handleWebFetch so a text page
        // still has a chance of providing evidence.
        getTweetLog()?.set(`${costPrefix}.media.${mediaIdx - 1}.ytdlp_error`, err?.message ?? "unknown error");
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

function buildSystemPrompt(acceptsMediaSources: boolean): string {
  const mediaRule = acceptsMediaSources
    ? `- Media URLs (videos, audio, images) may be presented with an automated content analysis block. For videos: title, uploader, content summary, on-screen text, audio transcript. For images: description and visible text. When present, treat that block as the source's content and evaluate it like any other fetched source. If the URL could not be analyzed as media, you'll see the raw web page instead (or a fetch error).`
    : `- Video/audio URLs (YouTube, Vimeo, TikTok, Twitch, etc.) cited as sources provide ZERO evidence — you cannot watch them.`;

  return `You verify whether the sources cited by a proposed community note support the correction made in that note, AND categorize each cited source as good or bad so the orchestrator can drop the bad ones from the final note.

Scope — what to ignore:
- Media, links, or videos embedded in the original post are NOT note sources. The post is shown only so you understand what the note is correcting. Do not evaluate whether the post's evidence is valid.
- The "Research findings" section is background reasoning from an earlier pipeline step, not a source. Treat a URL there as a source only if it also appears under "Note's cited sources".

Classification rules for each cited source:
- Twitter/X links (x.com, twitter.com) → always good.
- Any other source → good only if it (a) was successfully fetched (no "Fetch failed:" / "Fetch error:" / "Non-text content:" marker) AND (b) its content directly supports at least one factual claim in the note. Otherwise bad.
${mediaRule}

Output:
- good_sources: verbatim URLs (exactly as listed) that pass the rules above.
- bad_sources: every other cited URL — failed-to-fetch, irrelevant, or contradicts the note.
- Every cited URL must appear in exactly one of good_sources or bad_sources. Do not invent URLs.
- accepted: true iff good_sources together cover every factual claim in the note. Otherwise false, and name the unsupported claim in reasoning.`;
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

  const acceptMediaSources = config.verifier_accepts_media_sources ?? false;
  const { sections, fetchedCount, totalNonFreebie } = await fetchSourceContent(
    params.sources,
    `sourceVerifier.turn.${params.turnNumber}`,
    acceptMediaSources,
  );
  const systemPrompt = buildSystemPrompt(acceptMediaSources);

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
  let parsed: SourceVerification;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ModelOutputInvalidError(
      `sourceVerifier.turn.${params.turnNumber}: model output was not valid JSON. content="${content.slice(0, 200)}"`,
    );
  }

  // Defensive: clamp good_sources/bad_sources to URLs the writer actually
  // cited. A misbehaving model could echo URLs from the research findings
  // section or hallucinate; we never want the final submitted note to carry
  // a URL the writer didn't choose.
  const citedSet = new Set(params.sources);
  const result: SourceVerification = {
    good_sources: (parsed.good_sources ?? []).filter((u) => citedSet.has(u)),
    bad_sources: (parsed.bad_sources ?? []).filter((u) => citedSet.has(u)),
    accepted: !!parsed.accepted,
    reasoning: parsed.reasoning ?? "",
  };

  log?.set(`${logPrefix}.1`, { content: result });
  return result;
}
