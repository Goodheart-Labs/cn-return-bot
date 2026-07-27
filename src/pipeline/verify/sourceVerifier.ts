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
import { buildVerifierSystemPrompt, VERIFY_RESPONSE_FORMAT, VERIFY_CITATIONS_RESPONSE_FORMAT } from "../prompts/verify/sourceVerification";
import { CLAIM_EXTRACTION_SYSTEM_PROMPT, CLAIM_EXTRACTION_RESPONSE_FORMAT } from "../prompts/verify/claimExtraction";
import { buildClaimSupportSystemPrompt, CLAIM_SUPPORT_RESPONSE_FORMAT, CLAIM_SUPPORT_CITATIONS_RESPONSE_FORMAT } from "../prompts/verify/claimSupport";
import type { EvaluatedSource, SourceCitation } from "../prompts/verify/citations";

export interface SourceVerification {
  /** Reasoning for the verification decision. */
  reasoning: string;
  /** Cited URLs that support at least one factual claim in the note. Subset of the input sources. */
  good_sources: string[];
  /** Cited URLs that failed to fetch or don't support any factual claim. Subset of the input sources. */
  bad_sources: string[];
  /** True iff good_sources together cover every factual claim. */
  accepted: boolean;
  /** Per-source detail (snippets + explanation + verdict). Set only when the
   *  verifier_citations flag is on; undefined otherwise. */
  source_evaluations?: EvaluatedSource[];
}

/** Raw evaluated source as returned by the model in citations mode (both flows).
 *  Normalized into an EvaluatedSource by normalizeEvaluatedSource. */
interface RawEvaluatedSource {
  url: string;
  citations?: { quote: string; explanation?: string }[];
  verdict?: string;
}

/** Clamp citations + apply the "good needs ≥1 snippet of evidence" demotion. */
function normalizeEvaluatedSource(raw: RawEvaluatedSource): EvaluatedSource {
  const citations: SourceCitation[] = (raw.citations ?? []).map((c) => ({ quote: c.quote, explanation: c.explanation ?? "" }));
  const verdict = raw.verdict === "good" && citations.length > 0 ? "good" : "bad";
  return { url: raw.url, citations, verdict };
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
  /** The URL the writer cited. */
  url: string;
  /** Where the content was actually read from — differs from `url` only when
   *  the fetch ladder fell back to an archive snapshot. */
  fetchedUrl: string;
  content: string;
  fetched: boolean;
}

async function fetchSourceContent(
  sources: string[],
  costPrefix: string,
  logPrefix: string,
  acceptMediaSources: boolean,
  snippetsByUrl?: Map<string, { title: string; snippet: string }>,
): Promise<{ sections: string; fetchedCount: number; totalNonTwitter: number; snapshotUrls: Map<string, string> }> {
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
    snapshotUrls: new Map(results.filter((r) => r.fetchedUrl !== r.url).map((r) => [r.url, r.fetchedUrl])),
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
  if (tweet) return { url, fetchedUrl: url, content: formatTweetSection(url, tweet), fetched: true };
  return { url, fetchedUrl: url, content: `### ${url}\nTwitter/X link — tweet could not be fetched (deleted, protected, or unavailable); accepted without content.`, fetched: true };
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
    return { url, fetchedUrl: url, content: formatCascadeMediaSection(url, media), fetched: true };
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
  return { url, fetchedUrl: result.fetchedUrl, content: `### ${url}\n${content}`, fetched: !isFetchError };
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
  const { sections, fetchedCount, totalNonTwitter, snapshotUrls } = await fetchSourceContent(
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

  const verification = config.verifier_claim_based
    ? await runClaimBasedVerification(params, sections, costPrefix, logPrefix)
    : await runClassicVerification(params, sections, acceptMediaSources, costPrefix, logPrefix);

  return applySnapshotUrls(verification, snapshotUrls, logPrefix);
}

/** The cited URL is what the model sees and returns, but when the fetch ladder
 *  fell back to an archive snapshot that original is dead or blocked — only the
 *  snapshot serves the content we just verified. Publish the snapshot instead,
 *  so a note never cites a URL its readers can't open. Rejected sources keep
 *  their original URL: that's the one the writer chose and must stop reusing. */
function applySnapshotUrls(
  verification: SourceVerification,
  snapshotUrls: Map<string, string>,
  logPrefix: string,
): SourceVerification {
  if (snapshotUrls.size === 0) return verification;
  const toSnapshot = (url: string) => snapshotUrls.get(url) ?? url;
  getTweetLog()?.set(`${logPrefix}.snapshot_urls`, Object.fromEntries(snapshotUrls));
  return {
    ...verification,
    good_sources: verification.good_sources.map(toSnapshot),
    source_evaluations: verification.source_evaluations?.map((e) => ({ ...e, url: toSnapshot(e.url) })),
  };
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

/** Citations-mode classic derive: clamp the model's evaluated sources to the
 *  cited set, apply the good-needs-evidence demotion, and split into good/bad
 *  URL lists. A cited URL the model didn't return is treated as bad. */
function deriveClassicFromEvaluations(
  rawSources: RawEvaluatedSource[],
  cited: string[],
): { good_sources: string[]; bad_sources: string[]; source_evaluations: EvaluatedSource[] } {
  const citedSet = new Set(cited);
  const evaluations = rawSources.filter((s) => citedSet.has(s.url)).map(normalizeEvaluatedSource);
  const evaluatedUrls = new Set(evaluations.map((e) => e.url));
  return {
    good_sources: evaluations.filter((e) => e.verdict === "good").map((e) => e.url),
    bad_sources: [
      ...evaluations.filter((e) => e.verdict === "bad").map((e) => e.url),
      ...cited.filter((u) => !evaluatedUrls.has(u)),
    ],
    source_evaluations: evaluations,
  };
}

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
  const useCitations = config.verifier_citations ?? false;
  const systemPrompt = buildVerifierSystemPrompt(acceptMediaSources, useCitations);

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

  const model = config.verifier_model ?? config.model;
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userMessage },
  ];

  let result: SourceVerification;
  if (useCitations) {
    const parsed = await runJsonLlmCall<{ sources?: RawEvaluatedSource[]; reasoning?: string; accepted?: boolean }>({
      costName: costPrefix,
      model,
      messages,
      responseFormat: VERIFY_CITATIONS_RESPONSE_FORMAT,
      schemaHint: `{ "sources": [{ "url": string, "citations": [{ "quote": string, "explanation": string }], "verdict": "good"|"bad" }], "reasoning": string, "accepted": boolean }`,
    });
    result = {
      ...deriveClassicFromEvaluations(parsed.sources ?? [], params.sources),
      accepted: !!parsed.accepted,
      reasoning: parsed.reasoning ?? "",
    };
  } else {
    const parsed = await runJsonLlmCall<SourceVerification>({
      costName: costPrefix,
      model,
      messages,
      responseFormat: VERIFY_RESPONSE_FORMAT,
      schemaHint: `{ "good_sources": string[], "bad_sources": string[], "accepted": boolean, "reasoning": string }`,
    });
    const citedSet = new Set(params.sources);
    result = {
      good_sources: clampToCited(parsed.good_sources, citedSet),
      bad_sources: clampToCited(parsed.bad_sources, citedSet),
      accepted: !!parsed.accepted,
      reasoning: parsed.reasoning ?? "",
    };
  }

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

interface CitedClaimSupport {
  reasoning?: string;
  claim_support?: { claim: string; sources?: RawEvaluatedSource[] }[];
}

/** A claim plus the cited sources the model weighed against it. Off flow: every
 *  listed URL is a supporter (verdict "good", no citations). Citations flow: the
 *  verdict + snippets come from the model (a non-listed source = not supporting,
 *  so it never appears here). */
interface ClaimSourceMapping {
  claim: string;
  sources: EvaluatedSource[];
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
  const useCitations = config.verifier_citations ?? false;

  const claims = await extractClaims(params.noteText, costPrefix);
  log?.set(`${logPrefix}.claims`, claims);

  const systemPrompt = buildClaimSupportSystemPrompt(acceptMediaSources, useCitations);
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

  const model = config.verifier_model ?? config.model;
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userMessage },
  ];

  let reasoning: string;
  let mappings: ClaimSourceMapping[];
  if (useCitations) {
    const parsed = await runJsonLlmCall<CitedClaimSupport>({
      costName: costPrefix,
      model,
      messages,
      responseFormat: CLAIM_SUPPORT_CITATIONS_RESPONSE_FORMAT,
      schemaHint: `{ "reasoning": string, "claim_support": [{ "claim": string, "sources": [{ "url": string, "citations": [{ "quote": string, "explanation": string }], "verdict": "good"|"bad" }] }] }`,
    });
    reasoning = parsed.reasoning ?? "";
    mappings = (parsed.claim_support ?? []).map((e) => ({
      claim: e.claim,
      sources: (e.sources ?? []).map(normalizeEvaluatedSource),
    }));
  } else {
    const parsed = await runJsonLlmCall<ClaimSupport>({
      costName: costPrefix,
      model,
      messages,
      responseFormat: CLAIM_SUPPORT_RESPONSE_FORMAT,
      schemaHint: `{ "reasoning": string, "claim_support": [{ "claim": string, "supporting_sources": string[] }] }`,
    });
    reasoning = parsed.reasoning ?? "";
    mappings = (parsed.claim_support ?? []).map((e) => ({
      claim: e.claim,
      sources: (e.supporting_sources ?? []).map((url) => ({ url, citations: [], verdict: "good" as const })),
    }));
  }

  const result = deriveVerificationFromClaims(claims, reasoning, mappings, params.sources, useCitations);
  log?.set(`${messagesLogPrefix}.1`, { content: result });
  return result;
}

/** A source is good iff it supports at least one claim (after clamping to cited
 *  URLs). The note is accepted iff there is at least one claim and every claim
 *  has at least one cited supporting source. */
function deriveVerificationFromClaims(
  claims: string[],
  reasoning: string,
  mappings: ClaimSourceMapping[],
  cited: string[],
  withEvaluations: boolean,
): SourceVerification {
  const citedSet = new Set(cited);

  const goodSet = new Set<string>();
  const unsupportedClaims: string[] = [];
  for (const m of mappings) {
    const supporters = m.sources.filter((s) => s.verdict === "good" && citedSet.has(s.url));
    supporters.forEach((s) => goodSet.add(s.url));
    if (supporters.length === 0) unsupportedClaims.push(m.claim);
  }

  // The model must return a support entry for every extracted claim. If it
  // dropped some, those claims went unevaluated — treat that as not-accepted
  // rather than silently submitting a note with an unverified claim.
  const allClaimsCovered = mappings.length >= claims.length;
  const accepted = claims.length > 0 && allClaimsCovered && unsupportedClaims.length === 0;
  const reasonParts = [reasoning.trim()].filter(Boolean) as string[];
  if (unsupportedClaims.length > 0) {
    reasonParts.push(`Unsupported claim(s): ${unsupportedClaims.map((c) => `"${c}"`).join("; ")}`);
  }
  if (claims.length === 0) reasonParts.push("Claim extraction returned no claims.");
  else if (!allClaimsCovered) reasonParts.push(`Verifier mapped only ${mappings.length} of ${claims.length} claims.`);

  return {
    good_sources: [...goodSet],
    bad_sources: cited.filter((u) => !goodSet.has(u)),
    accepted,
    reasoning: reasonParts.join(" ") || (accepted ? "All claims supported." : "No claims supported."),
    ...(withEvaluations ? { source_evaluations: aggregateClaimEvaluations(mappings, cited, goodSet) } : {}),
  };
}

/** Collapse the per-claim source lists into one EvaluatedSource per cited URL:
 *  verdict good iff it supports ≥1 claim, citations deduped (by quote) across
 *  the claims that listed it. */
function aggregateClaimEvaluations(
  mappings: ClaimSourceMapping[],
  cited: string[],
  goodSet: Set<string>,
): EvaluatedSource[] {
  const citationsByUrl = new Map<string, SourceCitation[]>();
  for (const m of mappings) {
    for (const s of m.sources) {
      const list = citationsByUrl.get(s.url) ?? [];
      for (const c of s.citations) {
        if (!list.some((x) => x.quote === c.quote)) list.push(c);
      }
      citationsByUrl.set(s.url, list);
    }
  }
  return cited.map((url) => ({
    url,
    citations: citationsByUrl.get(url) ?? [],
    verdict: goodSet.has(url) ? "good" : "bad",
  }));
}
