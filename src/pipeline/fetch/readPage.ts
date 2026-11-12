/**
 * The page reader: the one function every caller uses to read an outside
 * page. The claim checks' fetch tool and source verifier use it, and so do
 * reading a post for the queue and reading an article for a minisite (GOO-755).
 *
 * It has three stages.
 *   1. A site with an API is asked through it, because its answer is cleaner
 *      than any page text. A YouTube video gives its captions, a LessWrong or
 *      Alignment Forum post its GraphQL answer, and an address of the shape
 *      /p/<slug> on any host Substack's post endpoint.
 *   2. The fetch ladder in the sandboxed fetcher (fetchLadder.ts).
 *   3. Jina Reader, while JINA_FALLBACK is on.
 * The stage is chosen by the address alone, never by what a caller knows
 * about it.
 *
 * Where it runs: in the calling service, which holds the keys that Jina and
 * the YouTube captions need. Everything that downloads or parses a stranger's
 * page runs in the fetcher. GitHub Actions never fetches an outside address
 * itself, so there readPage asks the extraction service to read the page.
 */

import { askFetcher, requestPageRead } from "../../service/client";
import { FETCH_PAGE_PATH, type LadderAnswer, type PageRead, type ReadPage } from "../../service/contract";
import { extractYoutubeVideoId } from "../../everything-core/pageUrls";
import { YoutubeUnreachableError } from "../media/youtubeCaptions";
import { YoutubeQuotaExceededError } from "../media/youtubeDataApi";
import { isWebUrl } from "../utils/webUrl";
import { classifyMarkdown, fetchPageWithLadder } from "./fetchLadder";
import { fetchWithJinaReader, JINA_FALLBACK } from "./jinaReader";
import { addSteps, logRead, readStep, type ReadOutcome, type ReadStep } from "./readLog";
import { parsePostUrl, readForumPost } from "./sites/forum";
import { readSubstackPost } from "./sites/substack";
import { readYoutubeVideo } from "./sites/youtube";

/** The most text of one page that any step reads: a fetched source, an
 *  article the Common Notes worker ingests, and the article Ask Opus gets as
 *  context. It matches the limit on note_requests.page_text. Until 2026-10-15
 *  a fetched source was cut at 20,000 characters, so the source verifier never
 *  saw quotes further down a long report. */
export const MAX_PAGE_TEXT_CHARS = 500_000;

/** A markdown page starts with its title as a level-one heading. */
const TITLE_HEADING = /^# (.+)\n+/;

export async function readPage(url: string): Promise<PageRead> {
  if (process.env.GITHUB_ACTIONS) return requestPageRead({ url });
  return logRead("page", url, () => readPageHere(url), summarizePageRead);
}

async function readPageHere(url: string): Promise<PageRead> {
  if (!isWebUrl(url)) return { type: "unreadable", reason: "only http and https addresses are read" };
  const read = (await readWithSiteApi(url)) ?? (await readWithLadder(url));
  return read.type === "page" ? { type: "page", page: { ...read.page, text: read.page.text.slice(0, MAX_PAGE_TEXT_CHARS) } } : read;
}

/** Stage 1. Null means the site has no API we know, or its API did not give
 *  the page. */
async function readWithSiteApi(url: string): Promise<PageRead | null> {
  if (extractYoutubeVideoId(url)) return readStep("youtube captions", () => readYoutubeVideo(url), describePageRead);
  const forumPost = parsePostUrl(url);
  if (forumPost) return readForumPost(forumPost, url);
  return readSubstackPost(url);
}

/** Stages 2 and 3. */
async function readWithLadder(url: string): Promise<PageRead> {
  const ladderStarted = Date.now();
  const ladder = await askFetcher<LadderAnswer>(FETCH_PAGE_PATH, { url }, () => fetchPageWithLadder(url));
  addSteps(ladder.attempts.map(({ label, ...attempt }) => ({ step: `ladder: ${label}`, ...attempt })), ladderStarted);
  if (ladder.ok) {
    const { title, text } = splitTitle(ladder.markdown);
    return { type: "page", page: { url: ladder.fetchedUrl, title, text, publishedAt: null, authorName: null, source: { kind: "ladder", html: ladder.html, via: ladder.via } } };
  }
  if (!JINA_FALLBACK) return { type: "unreadable", reason: ladder.diagnostic };
  const jina = await readStep("Jina Reader", () => fetchWithJinaReader(url), describeJinaAnswer);
  if (jina.type !== "page" || classifyMarkdown(jina.markdown) !== "good") {
    return { type: "unreadable", reason: `${ladder.diagnostic}; Jina Reader: ${describeJinaFailure(jina)}` };
  }
  const { title, text } = splitTitle(jina.markdown);
  // Jina reads the live page, so the page is cited at its own address.
  return { type: "page", page: { url, title, text, publishedAt: null, authorName: null, source: { kind: "jina" } } };
}

function describeJinaAnswer(jina: Awaited<ReturnType<typeof fetchWithJinaReader>>): Pick<ReadStep, "result" | "status" | "chars"> {
  if (jina.type === "page") return { result: classifyMarkdown(jina.markdown), chars: jina.markdown.length };
  return { result: jina.type === "target_error" ? "target_error" : describeJinaFailure(jina), status: jina.type === "target_error" ? jina.status : undefined };
}

function describePageRead(read: PageRead): Pick<ReadStep, "result" | "chars"> {
  return { result: read.type, chars: read.type === "page" ? read.page.text.length : undefined };
}

/** The read log's summary of a page read: what it gave, which stage served
 *  it, and its title and text for the day's file. */
function summarizePageRead(read: PageRead): ReadOutcome {
  if (read.type === "page") {
    const { source, title, text } = read.page;
    const via = source.kind === "ladder" ? `ladder${source.via ? `: ${source.via}` : ""}` : source.kind;
    return { outcome: "page", via, chars: text.length, reason: null, text: title ? `# ${title}\n\n${text}` : text };
  }
  return { outcome: read.type, via: null, chars: null, reason: read.type === "shortform" ? null : read.reason, text: null };
}

function describeJinaFailure(jina: Awaited<ReturnType<typeof fetchWithJinaReader>>): string {
  if (jina.type === "page") return "too little text, or a wall";
  if (jina.type === "target_error") return `the site answered HTTP ${jina.status}`;
  if (jina.type === "challenge") return "a bot check";
  return jina.reason;
}

function splitTitle(markdown: string): { title: string | null; text: string } {
  const heading = TITLE_HEADING.exec(markdown);
  return heading ? { title: heading[1]!.trim(), text: markdown.slice(heading[0].length) } : { title: null, text: markdown };
}

// ---------------------------------------------------------------------------
// For a model: the claim checks' fetch tool and source verifier
// ---------------------------------------------------------------------------

export interface WebFetchResult {
  /** The page as markdown under its title. When the read failed it holds a
   *  diagnostic that starts with "Fetch failed:", which the verifier's prompt
   *  knows to mean the source supports nothing. */
  content: string;
  /** The URL the content was actually read from. It is the archive snapshot when
   *  the ladder fell back to one, and the requested URL otherwise. Any caller
   *  that publishes the source, such as the note's citation, must use this URL
   *  and not the requested one. */
  fetchedUrl: string;
  ok: boolean;
}

/** Reads a page for a model to read. A source of a claim check that YouTube
 *  or its Data API cannot serve right now is a source the check goes on
 *  without, like a page the ladder could not read. Those two failures only
 *  say that one source is missing, so they do not stop the whole check. */
export async function readPageForModel(url: string): Promise<WebFetchResult> {
  try {
    return contentForModel(url, await readPage(url));
  } catch (err) {
    if (!(err instanceof YoutubeUnreachableError || err instanceof YoutubeQuotaExceededError)) throw err;
    return { content: `Fetch failed: ${err.message}`, fetchedUrl: url, ok: false };
  }
}

function contentForModel(url: string, read: PageRead): WebFetchResult {
  if (read.type === "page") return { content: pageForModel(read.page), fetchedUrl: read.page.url, ok: true };
  return { content: `Fetch failed: ${failureForModel(read)}`, fetchedUrl: url, ok: false };
}

function pageForModel(page: ReadPage): string {
  const via = viaLabel(page);
  const title = page.title ? `# ${page.title}\n\n` : "";
  return `${via ? `[fetched via ${via}]\n\n` : ""}${title}${page.text}`;
}

/** Tells the model when the text is not the live page as a person sees it. */
function viaLabel(page: ReadPage): string | null {
  switch (page.source.kind) {
    case "youtube":
      return "the video's captions";
    case "ladder":
      return page.source.via;
    case "jina":
      return "Jina Reader";
    default:
      return null;
  }
}

function failureForModel(read: Exclude<PageRead, { type: "page" }>): string {
  switch (read.type) {
    case "unreadable_video":
      return `YouTube says the video is ${read.reason === "no captions" ? "without captions" : read.reason}`;
    case "shortform":
      return "a forum shortform page, which has no text of its own";
    case "unreadable":
      return read.reason;
  }
}
