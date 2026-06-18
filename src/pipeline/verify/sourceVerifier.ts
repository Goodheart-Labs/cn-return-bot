/**
 * Source Verifier
 *
 * Checks whether cited sources actually support a community note. Two flows,
 * picked by config.verifier_claim_based:
 *   - classic (default): one LLM call categorizes each cited source good/bad and
 *     accepts iff the good ones cover every claim.
 *   - claim-based: one call extracts the note's distinct claims, a second maps
 *     each claim to its supporting cited sources. A source is good iff it
 *     supports ≥1 claim; the note is accepted iff every claim has ≥1 supporter.
 * Both share the same source-fetching cascade and return a SourceVerification.
 */

import { handleWebFetch } from "../tool-calling/tools";
import { getBotConfig } from "../ab-testing/botConfig";
import { getTweetLog } from "../utils/tweetLog";
import { STEP, COST } from "../utils/noteWriterSteps";
import { UnfetchableSourcesError } from "../utils/errors";
import { runJsonLlmCall, type ChatMessage } from "../utils/jsonLlmCall";
import {
  describeMediaFromUrl,
  type MediaSourceDescription,
  type GeminiMediaResult,
} from "../media/mediaAnalysisGemini";
import {
  collectPostImages,
  extractSourceImages,
  buildImagePayload,
  verifierModelSupportsImages,
  type VerifierImage,
} from "./verifierImages";
import { fetchTweetViaSyndication, type SyndicationTweet } from "./fetchTweet";
import { buildVerifierSystemPrompt, VERIFY_RESPONSE_FORMAT } from "../prompts/verify/sourceVerification";
import { CLAIM_EXTRACTION_SYSTEM_PROMPT, CLAIM_EXTRACTION_RESPONSE_FORMAT } from "../prompts/verify/claimExtraction";
import { buildClaimSupportSystemPrompt, CLAIM_SUPPORT_RESPONSE_FORMAT } from "../prompts/verify/claimSupport";

export interface SourceVerification {
  /** Reasoning for the verification decision. */
  reasoning: string;
  /** Cited URLs that support at least one factual claim in the note. Subset of the input sources. */
  good_sources: string[];
  /** Cited URLs that failed to fetch or don't support any factual claim. Subset of the input sources. */
  bad_sources: string[];
  /** True iff good_sources together cover every factual claim. */
  accepted: boolean;
}

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
  /** Images found in this source, for the vision verifier. Empty unless image
   *  collection is on (collectImages) and the source yielded usable images. */
  images: VerifierImage[];
}

async function fetchSourceContent(
  sources: string[],
  costPrefix: string,
  logPrefix: string,
  acceptMediaSources: boolean,
  collectImages: boolean,
  snippetsByUrl?: Map<string, { title: string; snippet: string }>,
): Promise<{ sections: string; fetchedCount: number; totalNonTwitter: number; images: VerifierImage[] }> {
  const results: FetchedSource[] = [];
  for (let i = 0; i < sources.length; i++) {
    const fetched = await fetchOneSource(sources[i]!, `${costPrefix}.source.${i}`, `${logPrefix}.source.${i}`, acceptMediaSources, collectImages);
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
    images: results.flatMap((r) => r.images),
  };
}

async function fetchOneSource(
  url: string,
  costName: string,
  logKey: string,
  acceptMediaSources: boolean,
  collectImages: boolean,
): Promise<FetchedSource> {
  if (isTwitterUrl(url)) {
    return fetchTwitterSource(url, costName, logKey, acceptMediaSources, collectImages);
  }
  if (acceptMediaSources) {
    const media = await tryMediaDescription(url, costName, logKey, collectImages);
    if (media) return media;
  }
  return fetchAsWebPage(url, collectImages);
}

/** Fetch a cited X post so the verifier can read it, rather than blind-accepting.
 *  Video tweets go through the yt-dlp cascade (when media is accepted); the rest
 *  fall back to the syndication endpoint for text + author. Only when both fail
 *  (deleted/protected/unavailable) do we accept it unread. */
async function fetchTwitterSource(
  url: string,
  costName: string,
  logKey: string,
  acceptMediaSources: boolean,
  collectImages: boolean,
): Promise<FetchedSource> {
  if (acceptMediaSources) {
    const media = await tryDescribeMedia(url, costName, logKey, collectImages);
    if (media) return media;
  }
  const tweet = await fetchTweetViaSyndication(url);
  if (tweet) return { url, content: formatTweetSection(url, tweet), fetched: true, images: [] };
  return { url, content: `### ${url}\nTwitter/X link — tweet could not be fetched (deleted, protected, or unavailable); accepted without content.`, fetched: true, images: [] };
}

function formatTweetSection(url: string, tweet: SyndicationTweet): string {
  const lines = [
    `### ${url}`,
    `Twitter/X post by ${tweet.authorName} (@${tweet.authorHandle}).`,
    tweet.createdAt ? `Published: ${tweet.createdAt}` : null,
    `Tweet text: ${tweet.text}`,
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}

/** Returns null when the URL isn't a media host or the cascade failed (caller falls through to handleWebFetch). */
async function tryMediaDescription(url: string, costName: string, logKey: string, collectImages: boolean): Promise<FetchedSource | null> {
  if (!isMediaHost(url)) return null;
  return tryDescribeMedia(url, costName, logKey, collectImages);
}

/** Run the yt-dlp/gallery-dl cascade + Gemini analysis, or null if it can't
 *  extract media (text-only post, removed content, unsupported host). */
async function tryDescribeMedia(url: string, costName: string, logKey: string, collectImages: boolean): Promise<FetchedSource | null> {
  try {
    const media = await describeMediaFromUrl(url, costName);
    const images = collectImages && media.imageDataUrl
      ? [{ url: media.imageDataUrl, origin: `cited source ${url}` }]
      : [];
    return { url, content: formatCascadeMediaSection(url, media), fetched: true, images };
  } catch (err: any) {
    getTweetLog()?.set(`${logKey}.media_error`, err?.message ?? "unknown error");
    return null;
  }
}

async function fetchAsWebPage(url: string, collectImages: boolean): Promise<FetchedSource> {
  const result = await handleWebFetch(url);
  const content = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
  const isFetchError =
    content.startsWith("Fetch failed:") ||
    content.startsWith("Fetch error:") ||
    content.startsWith("Non-text content:");
  const images = collectImages && !isFetchError ? extractSourceImages(content, url) : [];
  return { url, content: `### ${url}\n${content}`, fetched: !isFetchError, images };
}

export interface VerifySourcesParams {
  noteText: string;
  sources: string[];
  postContext: string;
  researcherFindings?: string;
  snippetsByUrl?: Map<string, { title: string; snippet: string }>;
  /** Post + quoted-tweet media analysis, so the verifier can see the post's
   *  images. Only used when the A/B flag + model are vision-capable. */
  mediaResult?: GeminiMediaResult;
  turnNumber: number;
}

export async function verifySources(params: VerifySourcesParams): Promise<SourceVerification> {
  const config = getBotConfig();
  const model = config.verifier_model ?? config.model;
  const costPrefix = `${COST.sourceVerifier}.turn.${params.turnNumber}`;
  const logPrefix = `${STEP.sourceVerifier}.turn.${params.turnNumber}`;

  const collectImages = (config.verifier_sees_images ?? false) && verifierModelSupportsImages(model);
  const acceptMediaSources = config.verifier_accepts_media_sources ?? false;
  const { sections, fetchedCount, totalNonTwitter, images: sourceImages } = await fetchSourceContent(
    params.sources,
    costPrefix,
    logPrefix,
    acceptMediaSources,
    collectImages,
    params.snippetsByUrl,
  );

  // verifier_sees_images: attach the post's images plus any images pulled from
  // the cited sources, so the verifier can catch out-of-context media. Only the
  // classic flow consumes these; gated to vision-capable models above.
  const images = collectImages
    ? [...collectPostImages(params.mediaResult), ...sourceImages]
    : [];

  if (totalNonTwitter > 0 && fetchedCount === 0) {
    throw new UnfetchableSourcesError(
      `None of the ${totalNonTwitter} non-Twitter source(s) could be fetched`,
    );
  }

  return config.verifier_claim_based
    ? runClaimBasedVerification(params, sections, costPrefix, logPrefix)
    : runClassicVerification(params, sections, acceptMediaSources, images, costPrefix, logPrefix);
}

/** Shared tail of the verifier user message: the fetched cited sources plus the
 *  post and research findings as background. The head (the note, or the
 *  extracted claims) is prepended by each flow. */
function buildSourcesContext(sections: string, params: VerifySourcesParams): string {
  const parts = [
    `## Note's cited sources (verify these)`,
    sections,
    ``,
    `## Original post (background — not a source)`,
    params.postContext,
  ];
  if (params.researcherFindings) {
    parts.push(``, `## Research findings (background — not a source)`, params.researcherFindings);
  }
  return parts.join("\n");
}

/** Restrict a model-returned URL list to URLs the writer actually cited. A
 *  misbehaving model could echo URLs from the research findings or hallucinate;
 *  the submitted note must never carry a URL the writer didn't choose. */
function clampToCited(urls: string[] | undefined, citedSet: Set<string>): string[] {
  return (urls ?? []).filter((u) => citedSet.has(u));
}

// --- Classic flow: single accept/reject call ---

async function runClassicVerification(
  params: VerifySourcesParams,
  sections: string,
  acceptMediaSources: boolean,
  images: VerifierImage[],
  costPrefix: string,
  logPrefix: string,
): Promise<SourceVerification> {
  const log = getTweetLog();
  const config = getBotConfig();
  const messagesLogPrefix = `${logPrefix}.messages`;

  const payload = images.length > 0 ? buildImagePayload(images) : null;
  const systemPrompt = buildVerifierSystemPrompt(acceptMediaSources, !!payload);

  const userMessage = [
    `## Context`,
    `Current date (UTC): ${new Date().toISOString()}`,
    ``,
    `## Proposed community note`,
    params.noteText,
    ``,
    buildSourcesContext(sections, params),
    ...(payload ? [``, payload.manifest] : []),
  ].join("\n");

  const userContent: ChatMessage["content"] = payload
    ? [{ type: "text", text: userMessage }, ...payload.parts]
    : userMessage;

  log?.set(`${messagesLogPrefix}.0`, {
    systemPrompt,
    userMessage,
    images: payload?.images.map((img, i) => ({ index: i + 1, origin: img.origin, url: img.url.slice(0, 80) })),
  });

  const parsed = await runJsonLlmCall<SourceVerification>({
    costName: costPrefix,
    model: config.verifier_model ?? config.model,
    messages: [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userContent },
    ],
    responseFormat: VERIFY_RESPONSE_FORMAT,
    schemaHint: `{ "good_sources": string[], "bad_sources": string[], "accepted": boolean, "reasoning": string }`,
  });

  const citedSet = new Set(params.sources);
  const result: SourceVerification = {
    good_sources: clampToCited(parsed.good_sources, citedSet),
    bad_sources: clampToCited(parsed.bad_sources, citedSet),
    accepted: !!parsed.accepted,
    reasoning: parsed.reasoning ?? "",
  };

  log?.set(`${messagesLogPrefix}.1`, { content: result });
  return result;
}

// --- Claim-based flow: extract claims, then map each to supporting sources ---

export interface ClaimExtraction {
  claims: string[];
}

/** First claim-based call: break the note into its distinct factual claims. */
export async function extractClaims(noteText: string, costPrefix: string): Promise<string[]> {
  const config = getBotConfig();
  const parsed = await runJsonLlmCall<ClaimExtraction>({
    costName: `${costPrefix}.claims`,
    model: config.verifier_model ?? config.model,
    messages: [
      { role: "system" as const, content: CLAIM_EXTRACTION_SYSTEM_PROMPT },
      { role: "user" as const, content: `## Proposed community note\n${noteText}` },
    ],
    responseFormat: CLAIM_EXTRACTION_RESPONSE_FORMAT,
    schemaHint: `{ "claims": string[] }`,
  });
  return parsed.claims ?? [];
}

interface ClaimSupport {
  reasoning: string;
  claim_support: { claim: string; supporting_sources: string[] }[];
}

async function runClaimBasedVerification(
  params: VerifySourcesParams,
  sections: string,
  costPrefix: string,
  logPrefix: string,
): Promise<SourceVerification> {
  const log = getTweetLog();
  const config = getBotConfig();
  const messagesLogPrefix = `${logPrefix}.messages`;
  const acceptMediaSources = config.verifier_accepts_media_sources ?? false;

  const claims = await extractClaims(params.noteText, costPrefix);
  log?.set(`${logPrefix}.claims`, claims);

  const systemPrompt = buildClaimSupportSystemPrompt(acceptMediaSources);
  const userMessage = [
    `## Context`,
    `Current date (UTC): ${new Date().toISOString()}`,
    ``,
    `## Claims to verify`,
    claims.map((c, i) => `${i + 1}. ${c}`).join("\n"),
    ``,
    buildSourcesContext(sections, params),
  ].join("\n");

  log?.set(`${messagesLogPrefix}.0`, { systemPrompt, userMessage });

  const parsed = await runJsonLlmCall<ClaimSupport>({
    costName: costPrefix,
    model: config.verifier_model ?? config.model,
    messages: [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userMessage },
    ],
    responseFormat: CLAIM_SUPPORT_RESPONSE_FORMAT,
    schemaHint: `{ "reasoning": string, "claim_support": [{ "claim": string, "supporting_sources": string[] }] }`,
  });

  const result = deriveVerificationFromClaims(claims, parsed, params.sources);
  log?.set(`${messagesLogPrefix}.1`, { content: result });
  return result;
}

/** A source is good iff it supports at least one claim (after clamping to cited
 *  URLs). The note is accepted iff there is at least one claim and every claim
 *  has at least one cited supporting source. */
function deriveVerificationFromClaims(
  claims: string[],
  parsed: ClaimSupport,
  cited: string[],
): SourceVerification {
  const citedSet = new Set(cited);
  const support = parsed.claim_support ?? [];

  const goodSet = new Set<string>();
  const unsupportedClaims: string[] = [];
  for (const entry of support) {
    const supporters = clampToCited(entry.supporting_sources, citedSet);
    supporters.forEach((u) => goodSet.add(u));
    if (supporters.length === 0) unsupportedClaims.push(entry.claim);
  }

  // The model must return a support entry for every extracted claim. If it
  // dropped some, those claims went unevaluated — treat that as not-accepted
  // rather than silently submitting a note with an unverified claim.
  const allClaimsCovered = support.length >= claims.length;
  const accepted = claims.length > 0 && allClaimsCovered && unsupportedClaims.length === 0;
  const reasonParts = [parsed.reasoning?.trim()].filter(Boolean) as string[];
  if (unsupportedClaims.length > 0) {
    reasonParts.push(`Unsupported claim(s): ${unsupportedClaims.map((c) => `"${c}"`).join("; ")}`);
  }
  if (claims.length === 0) reasonParts.push("Claim extraction returned no claims.");
  else if (!allClaimsCovered) reasonParts.push(`Verifier mapped only ${support.length} of ${claims.length} claims.`);

  return {
    good_sources: [...goodSet],
    bad_sources: cited.filter((u) => !goodSet.has(u)),
    accepted,
    reasoning: reasonParts.join(" ") || (accepted ? "All claims supported." : "No claims supported."),
  };
}
