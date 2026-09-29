/**
 * YouTube captions, for both pipelines. Common Notes reads a video's claims
 * off its captions and points each claim at the moment it was said. The X
 * pipeline's source verifier reads a cited video's captions as its transcript.
 *
 * Captions are the one thing about a video that the Data API cannot give us,
 * because its caption endpoints only serve the video's owner. So they come
 * through yt-dlp, acting as YouTube's own web player, through the residential
 * proxy.
 */

import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import { extractYoutubeVideoId } from "../../everything-core/pageUrls";
import { decodeHtmlEntities } from "../utils/html";
import { proxyArgs, runYtDlp, throughProxyIfYoutube } from "./ytDlpDownload";

/** How much of yt-dlp's complaint goes into an error message. */
const MAX_REASON_LENGTH = 200;

/** YouTube could not be reached, as opposed to YouTube answering that the
 *  video has no captions. The caller must treat this as a network failure:
 *  retry later, never record it as a fact about the video. Before GOO-169
 *  every such failure became "No transcript available" and the item was
 *  marked a permanent error. */
export class YoutubeUnreachableError extends Error {
  constructor(url: string, reason: string) {
    super(`YouTube could not be reached for ${url}: ${reason}`);
    this.name = "YoutubeUnreachableError";
  }
}

/** What yt-dlp prints when the trouble is the path to YouTube rather than the
 *  video: the residential proxy's requests hanging or being refused, a proxy
 *  address YouTube has flagged, our own kill of a hung call, or a PO token
 *  YouTube did not accept. */
const YOUTUBE_UNREACHABLE_RE =
  /Unable to download (API page|webpage)|operation timed out|ETIMEDOUT|wrong version number|HTTP Error 429|Sign in to confirm|PO Token/i;

/** How long one caption call may run before it is killed and counted as not
 *  having reached YouTube. A good call through the proxy takes 6 to 25
 *  seconds; one that is still running after a minute is hung on a dead proxy
 *  address, and a fresh address is what helps, not more waiting. */
const CAPTION_CALL_TIMEOUT_MS = 60_000;

/** Where the PO token provider listens: the bgutil server that
 *  ops/cn-pot-provider.service runs on the services machine and that
 *  .github/actions/setup-youtube-captions starts in an Actions run. */
const PO_TOKEN_PROVIDER_URL = process.env.PO_TOKEN_PROVIDER_URL ?? "http://127.0.0.1:4416";

/** A PO token for one video's captions. A PO token ("proof of origin") is
 *  what YouTube's web player presents to show it is a real player; without
 *  one YouTube lists a video's captions and refuses to hand them over. The
 *  provider generates it by running YouTube's own attestation script, in ten
 *  milliseconds once warm.
 *
 *  We ask the provider ourselves instead of letting yt-dlp's bgutil plugin do
 *  it, because the plugin passes yt-dlp's proxy on to the provider. The token
 *  was then generated through the residential proxy, whose path to Google
 *  hangs for hours at a time, and every caption call died waiting for it. A
 *  token is bound to the video, not to an address, so one generated directly
 *  is accepted for a download that goes through the proxy. */
async function fetchPoToken(videoId: string): Promise<string> {
  let answer: { poToken?: string; error?: string };
  try {
    const response = await fetch(`${PO_TOKEN_PROVIDER_URL}/get_pot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content_binding: videoId }),
      signal: AbortSignal.timeout(CAPTION_CALL_TIMEOUT_MS),
    });
    answer = (await response.json()) as { poToken?: string; error?: string };
  } catch (err: any) {
    throw new Error(`The PO token provider at ${PO_TOKEN_PROVIDER_URL} did not answer (${err?.message}). YouTube captions cannot be fetched without it; see ops/README.md.`);
  }
  if (!answer.poToken) throw new Error(`The PO token provider gave no token: ${answer.error ?? "empty answer"}`);
  return answer.poToken;
}

/** The arguments that make yt-dlp fetch captions as YouTube's own web player
 *  with the given token. Every other client yt-dlp would try first spends a
 *  minute and a half timing out on YouTube's internal API through the proxy. */
const webPlayerArgs = (poToken: string): string[] => ["--extractor-args", `youtube:player_client=web;po_token=web.subs+${poToken}`];

/** One yt-dlp caption process, with the proxy and the web player's token
 *  when the URL is YouTube's, returning what it wrote on both streams. Unlike
 *  execYtDlp it never throws on a non-zero exit, because the caption calls
 *  have to read stderr in every case: with --ignore-no-formats-error yt-dlp
 *  exits zero after a request that never got an answer, and stderr is the
 *  only place that says so. A call we killed for taking too long is reported
 *  as a timeout, which YOUTUBE_UNREACHABLE_RE counts as not having reached
 *  YouTube. */
async function runCaptionCall(url: string, args: string[], proxyUrl: string | undefined): Promise<{ stdout: string; stderr: string }> {
  const videoId = extractYoutubeVideoId(url);
  const playerArgs = videoId ? webPlayerArgs(await fetchPoToken(videoId)) : [];
  const run = await runYtDlp([...proxyArgs(proxyUrl), ...playerArgs, ...args], CAPTION_CALL_TIMEOUT_MS);
  const failure = run.error?.killed ? "yt-dlp operation timed out" : typeof run.error?.code === "string" ? run.error.message : "";
  return { stdout: run.stdout, stderr: failure ? `${run.stderr}\n${failure}` : run.stderr };
}

/** Runs a caption call until it got what it came for or YouTube has
 *  answered. `found` reads the result: caption files on disk, or tracks in a
 *  listing. Success is judged by that and never by the warnings, because a
 *  call that wrote the captions can still print "HTTP Error 429" for a page
 *  it did not need. A call that found nothing and whose output says YouTube
 *  was not reached throws YoutubeUnreachableError, and the proxy wrapper runs
 *  it again on a fresh connection until its tries run out. A call that found
 *  nothing while YouTube did answer returns null: the video has nothing to
 *  give. */
async function runCaptionCallUntilReached<Found>(url: string, args: string[], found: (stdout: string) => Found | null): Promise<Found | null> {
  return throughProxyIfYoutube(
    url,
    async (proxyUrl) => {
      const result = await runCaptionCall(url, args, proxyUrl);
      const value = found(result.stdout);
      if (value !== null) return value;
      const unreachableLine = result.stderr.split("\n").find((line) => YOUTUBE_UNREACHABLE_RE.test(line));
      if (!unreachableLine) return null;
      throw new YoutubeUnreachableError(url, unreachableLine.trim().slice(0, MAX_REASON_LENGTH));
    },
    (err) => err instanceof YoutubeUnreachableError,
  );
}

/** English is asked for first, because everything downstream of the transcript
 *  is written in English. The `.*` picks up the regional spellings (`en-US`) and
 *  the marker YouTube puts on an original English track (`en-orig`). */
const PREFERRED_TRANSCRIPT_LANG = "en.*";

/** How many of the video's own tracks are fetched when English is missing. They
 *  go in one call and we keep the first that parses. A video rarely has more
 *  than one original track, and every extra one is paid proxy traffic. */
const MAX_FALLBACK_LANGUAGES = 3;

/**
 * The video's captions as timestamped cues, or null when YouTube answered and
 * the video has no captions. When YouTube could not be reached at all, this
 * throws a YoutubeUnreachableError instead, so that a proxy outage is never
 * recorded as a video without captions (GOO-169).
 *
 * A video that is not in English has no English track at all, and its machine
 * translations are throttled hard enough by YouTube to be unusable, so we fall
 * back to the language the video is actually in. Listing the languages costs an
 * extra call, so it only happens once English has come back empty.
 */
export async function fetchYoutubeCaptions(url: string): Promise<SubtitleCue[] | null> {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "cn-yt-subs-"));
  try {
    const english = await fetchTimedTranscript(url, dir, PREFERRED_TRANSCRIPT_LANG);
    if (english?.length) return english;

    const languages = (await listOriginalSubtitleLanguages(url)).slice(0, MAX_FALLBACK_LANGUAGES);
    const own = languages.length ? await fetchTimedTranscript(url, dir, languages.join(",")) : null;
    return own?.length ? own : null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The timestamped cues of the video's captions in the given languages. It asks
 * for the subtitles a human wrote and falls back to the automatically generated
 * ones. It returns null when the video has no subtitles in those languages.
 *
 * The language is a yt-dlp selector, not a plain code, so `en.*` also picks up
 * the regional and uploader-specific spellings of a track. A video usually
 * carries several files that match, and the shortest name is the plain track:
 * `de` before `de-XwLwiJMB_Xs`. YouTube sometimes fails to serve one of them and
 * serves another fine, so every downloaded file is tried in that order.
 */
async function fetchTimedTranscript(url: string, outputDir: string, lang: string): Promise<SubtitleCue[] | null> {
  const outputTemplate = path.join(outputDir, "%(id)s.%(ext)s");
  // The first downloaded track that parses into cues. A non-zero exit still
  // leaves behind whatever finished downloading, and one good track is all we
  // need, so the files are read whatever the exit was.
  const downloadedCues = (): SubtitleCue[] | null => {
    const files = fs
      .readdirSync(outputDir)
      .filter((f) => f.endsWith(".vtt") || f.endsWith(".ttml") || f.endsWith(".srt"))
      .sort((a, b) => a.length - b.length);
    for (const file of files) {
      const cues = parseSubtitleToCues(fs.readFileSync(path.join(outputDir, file), "utf-8"));
      if (cues.length) return cues;
    }
    return null;
  };
  // Writing subtitles needs no video formats. Without the ignore flag a
  // player response that lists no formats aborts the call before the
  // subtitles are fetched.
  return runCaptionCallUntilReached(url, ["--write-subs", "--write-auto-subs", "--sub-lang", lang, "--skip-download", "--ignore-no-formats-error", "-o", outputTemplate, url], downloadedCues);
}

/**
 * The language codes of every caption track a video has, most useful first.
 *
 * YouTube offers each video's own track plus a machine translation of it into
 * every language it knows, and it names them inconsistently: on one video the
 * translations are `en-de-XwLwiJMB_Xs` and on another plain `en`, so a code
 * alone does not say whether a track is original or translated. The listing's
 * Name column does: a translated row reads "Estonian from German", an original
 * row is either blank or names its own language. So we keep the rows without a
 * "from" and drop the rest.
 *
 * The tracks an uploader supplied come first, because they are real subtitles
 * rather than speech recognition.
 */
async function listOriginalSubtitleLanguages(url: string): Promise<string[]> {
  const listedLanguages = (stdout: string): string[] | null => {
    const languages = parseSubtitleListing(stdout);
    return languages.length ? languages : null;
  };
  return (await runCaptionCallUntilReached(url, ["--list-subs", "--skip-download", "--ignore-no-formats-error", url], listedLanguages)) ?? [];
}

/** Reads the language codes out of what `yt-dlp --list-subs` prints. */
export function parseSubtitleListing(listing: string): string[] {
  const uploaded: string[] = [];
  const automatic: string[] = [];
  let section: "uploaded" | "automatic" | null = null;
  for (const line of listing.split("\n")) {
    if (/Available subtitles for/i.test(line)) section = "uploaded";
    else if (/Available automatic captions for/i.test(line)) section = "automatic";
    else if (/^\s*$/.test(line)) section = null;
    if (!section) continue;

    // A row is "<code> <name columns> <formats>". The name is what matters and
    // the columns are only padded with spaces, so the whole rest of the line is
    // searched for the "from" that marks a translation. A format name never
    // contains it.
    const row = /^([A-Za-z0-9_-]+)\s+(\S.*)$/.exec(line);
    if (!row || row[1] === "Language") continue;
    const [, code, rest] = row;
    if (/\bfrom\b/i.test(rest!)) continue;
    (section === "uploaded" ? uploaded : automatic).push(code!);
  }
  return [...uploaded, ...automatic];
}

export interface SubtitleCue {
  /** Start time in seconds (float). */
  start: number;
  /** End time in seconds (float). */
  end: number;
  text: string;
}

/** Turn a subtitle timecode into seconds. It accepts the forms "00:01:23.456",
 *  "01:23,456" and "83.4". */
function parseTimecode(tc: string): number {
  return tc.replace(",", ".").split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}

/**
 * Parse a WEBVTT or SRT subtitle file into cues that carry a start and an end
 * time. Every line is stripped of its cue tags and its HTML entities, and a
 * line that repeats the line before it is dropped. Each surviving line is
 * tagged with the start and the end of the cue it sits in. The plain text
 * version below builds on this function and joins the cue texts together.
 */
export function parseSubtitleToCues(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let prev = "";
  let curStart = 0;
  let curEnd = 0;
  // No spoken text can come before the first timing line, so everything above
  // it is a header and is thrown away. Naming the headers one by one is not
  // enough: a file can open with a style block whose CSS would otherwise be
  // read as the video's first words.
  let started = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === "WEBVTT") continue;
    if (line.startsWith("NOTE ")) continue;
    const arrow = line.indexOf("-->");
    if (arrow === -1 && !started) continue;
    if (arrow !== -1) {
      started = true;
      // A timing line looks like "00:00:00.000 --> 00:00:02.000 align:start position:0%".
      // It can carry extra layout settings, so we keep only the word next to
      // the arrow on each side.
      curStart = parseTimecode(line.slice(0, arrow).trim().split(/\s+/).pop() ?? "0");
      curEnd = parseTimecode(line.slice(arrow + 3).trim().split(/\s+/)[0] ?? "0");
      continue;
    }
    if (/^\d+$/.test(line)) continue; // A line of only digits is an SRT cue number.
    const cleaned = decodeHtmlEntities(line.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    // YouTube's automatic captions build a line up word by word, so they repeat
    // the same line many times.
    if (cleaned === prev) continue;
    cues.push({ start: curStart, end: curEnd, text: cleaned });
    prev = cleaned;
  }
  return cues;
}

/** The captions as one plain text, for a reader that needs no timestamps. */
export function captionsToText(cues: SubtitleCue[]): string {
  return cues.map((cue) => cue.text).join(" ");
}
