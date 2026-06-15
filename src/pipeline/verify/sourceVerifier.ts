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
import { runJsonLlmCall } from "../utils/jsonLlmCall";
import {
  describeMediaFromUrl,
  type MediaSourceDescription,
} from "../media/mediaAnalysisGemini";
import { fetchTweetViaSyndication, type SyndicationTweet } from "./fetchTweet";

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

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "source_verification",
    strict: true,
    schema: {
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
    return fetchTwitterSource(url, costName, logKey, acceptMediaSources);
  }
  if (acceptMediaSources) {
    const media = await tryMediaDescription(url, costName, logKey);
    if (media) return media;
  }
  return fetchAsWebPage(url);
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
): Promise<FetchedSource> {
  if (acceptMediaSources) {
    const media = await tryDescribeMedia(url, costName, logKey);
    if (media) return media;
  }
  const tweet = await fetchTweetViaSyndication(url);
  if (tweet) return { url, content: formatTweetSection(url, tweet), fetched: true };
  return { url, content: `### ${url}\nTwitter/X link — tweet could not be fetched (deleted, protected, or unavailable); accepted without content.`, fetched: true };
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
async function tryMediaDescription(url: string, costName: string, logKey: string): Promise<FetchedSource | null> {
  if (!isMediaHost(url)) return null;
  return tryDescribeMedia(url, costName, logKey);
}

/** Run the yt-dlp/gallery-dl cascade + Gemini analysis, or null if it can't
 *  extract media (text-only post, removed content, unsupported host). */
async function tryDescribeMedia(url: string, costName: string, logKey: string): Promise<FetchedSource | null> {
  try {
    const media = await describeMediaFromUrl(url, costName);
    return { url, content: formatCascadeMediaSection(url, media), fetched: true };
  } catch (err: any) {
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

export interface VerifySourcesParams {
  noteText: string;
  sources: string[];
  postContext: string;
  researcherFindings?: string;
  snippetsByUrl?: Map<string, { title: string; snippet: string }>;
  turnNumber: number;
}

export async function verifySources(params: VerifySourcesParams): Promise<SourceVerification> {
  const config = getBotConfig();
  const costPrefix = `${COST.sourceVerifier}.turn.${params.turnNumber}`;
  const logPrefix = `${STEP.sourceVerifier}.turn.${params.turnNumber}`;

  const acceptMediaSources = config.verifier_accepts_media_sources ?? false;
  const { sections, fetchedCount, totalNonTwitter } = await fetchSourceContent(
    params.sources,
    costPrefix,
    logPrefix,
    acceptMediaSources,
    params.snippetsByUrl,
  );

  if (totalNonTwitter > 0 && fetchedCount === 0) {
    throw new UnfetchableSourcesError(
      `None of the ${totalNonTwitter} non-Twitter source(s) could be fetched`,
    );
  }

  return config.verifier_claim_based
    ? runClaimBasedVerification(params, sections, costPrefix, logPrefix)
    : runClassicVerification(params, sections, acceptMediaSources, costPrefix, logPrefix);
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
  costPrefix: string,
  logPrefix: string,
): Promise<SourceVerification> {
  const log = getTweetLog();
  const config = getBotConfig();
  const messagesLogPrefix = `${logPrefix}.messages`;
  const systemPrompt = buildSystemPrompt(acceptMediaSources);

  const userMessage = [
    `## Context`,
    `Current date (UTC): ${new Date().toISOString()}`,
    ``,
    `## Proposed community note`,
    params.noteText,
    ``,
    buildSourcesContext(sections, params),
  ].join("\n");

  log?.set(`${messagesLogPrefix}.0`, { systemPrompt, userMessage });

  const parsed = await runJsonLlmCall<SourceVerification>({
    costName: costPrefix,
    model: config.verifier_model ?? config.model,
    messages: [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userMessage },
    ],
    responseFormat: RESPONSE_FORMAT,
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

const CLAIM_EXTRACTION_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "note_claims",
    strict: true,
    schema: {
      type: "object",
      properties: {
        claims: {
          type: "array",
          items: { type: "string" },
          description: "The distinct factual claims asserted by the note, each a self-contained verifiable statement.",
        },
      },
      required: ["claims"],
      additionalProperties: false,
    },
  },
};

const CLAIM_EXTRACTION_SYSTEM_PROMPT = `Extract the distinct atomic claims made.

Output JSON: { "claims": string[] }`;

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
    responseFormat: CLAIM_EXTRACTION_FORMAT,
    schemaHint: `{ "claims": string[] }`,
  });
  return parsed.claims ?? [];
}

interface ClaimSupport {
  reasoning: string;
  claim_support: { claim: string; supporting_sources: string[] }[];
}

const CLAIM_SUPPORT_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "claim_support",
    strict: true,
    schema: {
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
    },
  },
};

function buildClaimSupportSystemPrompt(acceptsMediaSources: boolean): string {
  const mediaRule = acceptsMediaSources
    ? `- Media URLs (videos, audio, images) appear with an automated content analysis block (title, summary, on-screen/visible text, transcript). Treat that block as the source's content. If it could not be analyzed you'll see the raw page or a fetch error instead.`
    : `- Video/audio URLs (YouTube, Vimeo, TikTok, Twitch, etc.) provide ZERO evidence — you cannot watch them, so never list them as supporting.`;

  return `For each factual claim of a proposed community note, list the cited source URLs whose content directly supports that claim.

Rules:
- A source supports a claim only if its fetched content states or clearly implies that claim. If it doesn't, omit it for that claim.
- Twitter/X links come with the fetched tweet text and author; list one as supporting a claim only if that tweet text states or clearly implies the claim. A tweet marked "could not be fetched" supports a claim only when the claim is about that post itself.
- A source that failed to fetch ("Fetch failed:" / "Fetch error:" / "Non-text content:") supports nothing.
${mediaRule}

Scope — what to ignore:
- The original post and any "Research findings" are background, not sources. Only URLs under "Note's cited sources" may be listed.
- Sources marked "[from search snippet]" were not fully fetched; judge them from the available snippet.

Output JSON: { "reasoning": string, "claim_support": [{ "claim": string, "supporting_sources": string[] }] }
- Include every claim, in the order given. Use the verbatim cited URLs. supporting_sources may be empty when nothing supports the claim.`;
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
    responseFormat: CLAIM_SUPPORT_FORMAT,
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
