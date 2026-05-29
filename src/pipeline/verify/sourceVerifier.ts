/**
 * Source Verifier
 *
 * Single LLM call that checks whether cited sources actually support a community note.
 * Fetches source content, then asks the model to accept or reject.
 */

import { handleWebFetch } from "../tool-calling/tools";
import { getBotConfig, llmTuningParams } from "../ab-testing/botConfig";
import { trackedLlmCreate, trackLlmCall } from "../cost-tracking/costTracker";
import { getTweetLog } from "../utils/tweetLog";
import { STEP } from "../utils/noteWriterSteps";
import { UnfetchableSourcesError, ModelOutputInvalidError } from "../utils/errors";
import {
  describeMediaFromUrl,
  type MediaSourceDescription,
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

// Hosts where we attempt the media-download cascade (yt-dlp → gallery-dl)
// before falling back to handleWebFetch. yt-dlp covers video-leaning hosts;
// gallery-dl covers image-leaning hosts (Reddit/Tumblr/Imgur) and rescues
// Facebook/Instagram image posts that yt-dlp can't extract.
const MEDIA_HOSTS = [
  "youtube.com", "youtu.be",
  "vimeo.com",
  "tiktok.com",
  "twitch.tv",
  "facebook.com", "fb.watch",
  "instagram.com",
  "dailymotion.com",
  "rumble.com",
  "reddit.com", "redd.it",
  "tumblr.com",
  "imgur.com",
];

function isMediaHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return MEDIA_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const PLATFORM_DESCRIPTION_MAX_CHARS = 1500;

function formatCascadeMediaSection(url: string, media: MediaSourceDescription): string {
  const { kind, meta, analysis } = media;
  const publishedIso = meta.timestamp ? new Date(meta.timestamp * 1000).toISOString() : null;
  const platformDesc = meta.description?.slice(0, PLATFORM_DESCRIPTION_MAX_CHARS);
  const header = kind === "video"
    ? `Automated video analysis (yt-dlp + Gemini). Treat this as the source's content.`
    : `Automated image analysis (yt-dlp / gallery-dl + Gemini) — this URL is an image post, not a video. Treat this as the source's content.`;

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

interface FetchedSource {
  url: string;
  content: string;
  fetched: boolean;
}

async function fetchSourceContent(
  sources: string[],
  costPrefix: string,
  logPrefix: string,
  acceptMediaSources: boolean,
  snippetsByUrl?: Map<string, { title: string; snippet: string }>,
): Promise<{ sections: string; fetchedCount: number; totalNonTwitter: number }> {
  const results: FetchedSource[] = [];
  for (let i = 0; i < sources.length; i++) {
    const fetched = await fetchOneSource(sources[i]!, `${costPrefix}.source.${i}`, `${logPrefix}.source.${i}`, acceptMediaSources);
    // Fallback: if the full fetch failed but we have a search snippet for this
    // URL, use it so the verifier has something to evaluate rather than nothing.
    if (!fetched.fetched && snippetsByUrl?.has(fetched.url)) {
      const { title, snippet } = snippetsByUrl.get(fetched.url)!;
      fetched.content = `### ${fetched.url}\n[from search snippet — full page could not be fetched]\n**${title}**\n${snippet}`;
      fetched.fetched = true;
    }
    results.push(fetched);
  }
  const sections = results.map((r) => r.content).join("\n\n");
  const nonTwitter = results.filter((r) => !isTwitterUrl(r.url));
  return {
    sections,
    fetchedCount: nonTwitter.filter((r) => r.fetched).length,
    totalNonTwitter: nonTwitter.length,
  };
}

async function fetchOneSource(
  url: string,
  costName: string,
  logKey: string,
  acceptMediaSources: boolean,
): Promise<FetchedSource> {
  if (isTwitterUrl(url)) {
    return { url, content: `### ${url}\nTwitter/X link — accepted without fetching.`, fetched: true };
  }
  if (acceptMediaSources) {
    const media = await tryMediaDescription(url, costName, logKey);
    if (media) return media;
  }
  return fetchAsWebPage(url);
}

/** Returns null when the URL isn't a media host or the cascade failed (caller falls through to handleWebFetch). */
async function tryMediaDescription(url: string, costName: string, logKey: string): Promise<FetchedSource | null> {
  if (!isMediaHost(url)) return null;
  try {
    const media = await describeMediaFromUrl(url, costName);
    return { url, content: formatCascadeMediaSection(url, media), fetched: true };
  } catch (err: any) {
    // Neither yt-dlp nor gallery-dl could handle this URL (text-only post,
    // removed content, private account, or host not yet supported).
    getTweetLog()?.set(`${logKey}.media_error`, err?.message ?? "unknown error");
    return null;
  }
}

async function fetchAsWebPage(url: string): Promise<FetchedSource> {
  const result = await handleWebFetch(url);
  const content = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
  const isFetchError =
    content.startsWith("Fetch failed:") ||
    content.startsWith("Fetch error:") ||
    content.startsWith("Non-text content:");
  return { url, content: `### ${url}\n${content}`, fetched: !isFetchError };
}

function buildSystemPrompt(acceptsMediaSources: boolean): string {
  const mediaRule = acceptsMediaSources
    ? `- Media URLs (videos, audio, images) may be presented with an automated content analysis block. For videos: title, uploader, content summary, on-screen text, audio transcript. For images: description and visible text. When present, treat that block as the source's content and evaluate it like any other fetched source. If the URL could not be analyzed as media, you'll see the raw web page instead (or a fetch error).`
    : `- Video/audio URLs (YouTube, Vimeo, TikTok, Twitch, etc.) cited as sources provide ZERO evidence — you cannot watch them.`;

  return `You verify whether the sources cited by a proposed community note support the correction made in that note, AND categorize each cited source as good or bad so the orchestrator can drop the bad ones from the final note.

Scope — what to ignore:
- Media, links, or videos embedded in the original post are NOT note sources. The post is shown only so you understand what the note is correcting. Do not evaluate whether the post's evidence is valid.
- If a "Research findings" section is present, it is background reasoning from an earlier pipeline step, not a source. Treat a URL there as a source only if it also appears under "Note's cited sources".
- Sources marked "[from search snippet]" were not fully fetched; evaluate them based on the available title and snippet text.

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
  researcherFindings?: string;
  snippetsByUrl?: Map<string, { title: string; snippet: string }>;
  turnNumber: number;
}): Promise<SourceVerification> {
  const log = getTweetLog();
  const config = getBotConfig();
  const costPrefix = `sourceVerifier.turn.${params.turnNumber}`;
  const logPrefix = `${STEP.sourceVerifier}.turn.${params.turnNumber}`;
  const messagesLogPrefix = `${logPrefix}.messages`;

  const acceptMediaSources = config.verifier_accepts_media_sources ?? false;
  const { sections, fetchedCount, totalNonTwitter } = await fetchSourceContent(
    params.sources,
    costPrefix,
    logPrefix,
    acceptMediaSources,
    params.snippetsByUrl,
  );
  const systemPrompt = buildSystemPrompt(acceptMediaSources);

  const messageParts = [
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
  ];
  if (params.researcherFindings) {
    messageParts.push(``, `## Research findings (background — not a source)`, params.researcherFindings);
  }
  const userMessage = messageParts.join("\n");

  log?.set(`${messagesLogPrefix}.0`, { systemPrompt: systemPrompt, userMessage });

  if (totalNonTwitter > 0 && fetchedCount === 0) {
    throw new UnfetchableSourcesError(
      `None of the ${totalNonTwitter} non-Twitter source(s) could be fetched`,
    );
  }

  const { response, costEntry } = await trackedLlmCreate(costPrefix, {
    model: config.verifier_model ?? config.model,
    messages: [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userMessage },
    ],
    response_format: RESPONSE_FORMAT,
    ...llmTuningParams(config),
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

  log?.set(`${messagesLogPrefix}.1`, { content: result });
  return result;
}
