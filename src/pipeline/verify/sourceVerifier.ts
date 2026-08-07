/**
 * Source verifier.
 *
 * This module checks whether the sources a community note cites actually
 * support it. There are two flows and config.verifier_claim_based picks between
 * them.
 *
 * The classic flow is the default. One LLM call sorts each cited source into
 * good or bad. It accepts the note only when the good sources cover every
 * claim.
 *
 * The claim-based flow uses two calls. The first extracts the distinct claims
 * the note makes. The second maps each claim to the cited sources that support
 * it. A source is good when it supports at least one claim. The note is
 * accepted only when every claim has at least one supporting source.
 *
 * Both flows use the same cascade for fetching sources, and both return a
 * SourceVerification.
 */

import { fetchWebPage } from "../tool-calling/tools";
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
  /** Cited URLs that support at least one factual claim in the note. This is
   *  always a subset of the input sources. */
  good_sources: string[];
  /** Cited URLs that failed to fetch, or that support no factual claim. This is
   *  always a subset of the input sources. */
  bad_sources: string[];
  /** True when good_sources together cover every factual claim, and false
   *  otherwise. */
  accepted: boolean;
  /** Per-source detail, holding the snippets, the explanation and the verdict.
   *  This is set only when the verifier_citations flag is on. Otherwise it is
   *  undefined. */
  source_evaluations?: EvaluatedSource[];
}

/** An evaluated source exactly as the model returns it in citations mode. Both
 *  flows use this shape. normalizeEvaluatedSource turns it into an
 *  EvaluatedSource. */
interface RawEvaluatedSource {
  url: string;
  citations?: { quote: string; explanation?: string }[];
  verdict?: string;
}

/** Normalizes the citations the model returned for one source. A source is only
 *  allowed to stay good if it comes with at least one snippet of evidence.
 *  Otherwise it is demoted to bad. */
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

// On these hosts we try the media-download cascade before falling back to
// fetchWebPage. The cascade runs yt-dlp first and gallery-dl second. yt-dlp
// covers the hosts that mostly carry video. gallery-dl covers the hosts that
// mostly carry images, such as Reddit, Tumblr and Imgur. It also rescues the
// Facebook and Instagram image posts that yt-dlp cannot extract.
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
  /** Where the content was actually read from. This differs from `url` only
   *  when the fetch ladder fell back to an archive snapshot. */
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
    // If the full fetch failed but we have a search snippet for this URL, fall
    // back to the snippet. That gives the verifier something to evaluate
    // instead of nothing.
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

/** Fetches a cited X post so the verifier can read it instead of accepting it
 *  unread. When media sources are accepted, video tweets go through the yt-dlp
 *  cascade. Every other tweet falls back to the syndication endpoint, which
 *  gives us the text and the author. Only when both of those fail do we accept
 *  the post unread. That happens when the post is deleted, protected, or
 *  otherwise unavailable. */
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

/** Runs the media cascade when the URL is on a media host. Returns null when
 *  the URL is not on one, or when the cascade failed. The caller then falls
 *  through to fetchWebPage. */
async function tryMediaDescription(url: string, costName: string, logKey: string): Promise<FetchedSource | null> {
  if (!isMediaHost(url)) return null;
  return tryDescribeMedia(url, costName, logKey);
}

/** Runs the yt-dlp and gallery-dl cascade followed by the Gemini analysis.
 *  Returns null when no media can be extracted. That happens for a text-only
 *  post, for removed content, and for an unsupported host. */
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
  const { content, fetchedUrl, ok } = await fetchWebPage(url);
  return { url, fetchedUrl, content: `### ${url}\n${content}`, fetched: ok };
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

/** The model sees and returns the cited URL. When the fetch ladder fell back to
 *  an archive snapshot, that original URL is dead or blocked, and only the
 *  snapshot serves the content we just verified. So we publish the snapshot
 *  instead. A note then never cites a URL its readers cannot open. Rejected
 *  sources keep their original URL, because that is the URL the writer chose and
 *  must stop reusing. */
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

/** Builds the shared tail of the verifier's user message. It holds the fetched
 *  cited sources, plus the post and the research findings as background. Each
 *  flow prepends its own head, which is either the note or the extracted
 *  claims. */
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

/** Restricts a URL list the model returned to the URLs the writer actually
 *  cited. A misbehaving model could echo URLs from the research findings, or
 *  invent them outright. The submitted note must never carry a URL the writer
 *  did not choose. */
function clampToCited(urls: string[] | undefined, citedSet: Set<string>): string[] {
  return (urls ?? []).filter((u) => citedSet.has(u));
}

// --- Classic flow: a single accept or reject call ---

/** Derives the classic flow's result from the model's evaluated sources in
 *  citations mode. It clamps those sources to the cited set, demotes any source
 *  that came without evidence, and splits the rest into a good list and a bad
 *  list. A cited URL the model did not return at all counts as bad. */
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

// --- Claim-based flow: extract the claims, then map each one to its supporting sources ---

export interface ClaimExtraction {
  claims: string[];
}

/** The first call of the claim-based flow. It breaks the note into its distinct
 *  factual claims. */
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

/** A claim plus the cited sources the model weighed against it. When citations
 *  are off, every listed URL is a supporter, so it gets the verdict "good" and
 *  no citations. When citations are on, the verdict and the snippets come from
 *  the model. A source the model does not list does not support the claim, so it
 *  never appears here at all. */
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

/** A source is good when it supports at least one claim, after the sources have
 *  been clamped to the cited URLs. The note is accepted when there is at least
 *  one claim and every claim has at least one cited supporting source. */
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
  // dropped some, those claims were never evaluated. We treat that as not
  // accepted, rather than silently submitting a note with an unverified claim.
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

/** Collapses the per-claim source lists into one EvaluatedSource per cited URL.
 *  A URL gets the verdict good when it supports at least one claim. Its
 *  citations are gathered from every claim that listed it, with duplicate quotes
 *  removed. */
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
