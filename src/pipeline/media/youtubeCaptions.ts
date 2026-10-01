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

import { decodeHtmlEntities } from "../utils/html";
import { fetchTextViaResidentialProxy, hideProxyAddress, withResidentialProxy } from "../utils/residentialProxy";
import type { YoutubeVideo } from "./youtubeDataApi";
import { proxyArgs, runYtDlp } from "./ytDlpDownload";

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

/** One yt-dlp process that dumps the video's details as JSON, through the
 *  given proxy and as the web player with its token, returning what it wrote
 *  on both streams. Unlike execYtDlp it never throws on a non-zero exit,
 *  because the caller has to read stderr in every case: with
 *  --ignore-no-formats-error yt-dlp exits zero after a request that never got
 *  an answer, and stderr is the only place that says so. A call we killed for
 *  taking too long is reported as a timeout, which YOUTUBE_UNREACHABLE_RE
 *  counts as not having reached YouTube. */
async function dumpVideoJson(video: YoutubeVideo, proxyUrl: string | undefined): Promise<{ stdout: string; stderr: string }> {
  const args = [...proxyArgs(proxyUrl), ...webPlayerArgs(await fetchPoToken(video.videoId)), "--dump-single-json", "--skip-download", "--ignore-no-formats-error", video.url];
  const run = await runYtDlp(args, CAPTION_CALL_TIMEOUT_MS);
  const failure = run.error?.killed ? "yt-dlp operation timed out" : typeof run.error?.code === "string" ? run.error.message : "";
  return { stdout: run.stdout, stderr: failure ? `${run.stderr}\n${failure}` : run.stderr };
}

/** One caption track of a video, as yt-dlp's JSON dump describes it. */
export interface CaptionTrack {
  /** yt-dlp's name for the track, such as `en`, `en-US-orig` or `en-ko`. */
  code: string;
  /** "uploaded" means a person wrote it. "automatic" means YouTube's speech
   *  recognition made it. */
  kind: "uploaded" | "automatic";
  /** The track's WebVTT file. */
  url: string;
}

/** The track's language without its region or variant: `en` for `en-US-orig`. */
const baseLanguage = (code: string): string => code.split("-")[0]!.toLowerCase();

/** YouTube offers every video's captions machine-translated into a hundred
 *  languages, made on request. Such a file's address carries the target
 *  language as `tlang`. YouTube answers "HTTP Error 429: Too Many Requests"
 *  to almost every such request, whatever the address, the timing or the PO
 *  token (GOO-276). The video's own tracks it serves every time. So we never
 *  ask for a translation. */
const isMachineTranslation = (track: CaptionTrack): boolean => new URL(track.url).searchParams.has("tlang");

/** The tracks in yt-dlp's JSON dump of a video, the uploaded ones first. Only
 *  the WebVTT form of each is kept, because that is the form we parse. */
export function captionTracksFromDump(dump: { subtitles?: Record<string, any[]>; automatic_captions?: Record<string, any[]> }): CaptionTrack[] {
  const tracksOf = (kind: CaptionTrack["kind"], byCode: Record<string, any[]> | undefined): CaptionTrack[] =>
    Object.entries(byCode ?? {}).flatMap(([code, files]) => files.filter((file) => file.ext === "vtt").map((file) => ({ code, kind, url: file.url as string })));
  return [...tracksOf("uploaded", dump.subtitles), ...tracksOf("automatic", dump.automatic_captions)];
}

/**
 * The one track we download, or null when the video has no original track at
 * all. English comes first, because everything downstream of the transcript
 * is written in English. After that comes the language the video is spoken
 * in, which the Data API reports, and then any other original track. Within
 * one language, a track a person wrote beats speech recognition, and the
 * shortest code is the plain track: `en` before `en-JkeT_87f4cc`.
 *
 * Many channels let YouTube dub their videos into other languages. Such a
 * video has an audio track per language and a speech recognition track per
 * audio track, so an English dub of a Spanish video brings its own English
 * captions. yt-dlp names these `<language>-orig`. On such a video it gives the
 * plain name `en` to a machine translation. So a code alone never says whether
 * a track is a translation, and we look at the track's address instead.
 */
export function chooseCaptionTrack(tracks: CaptionTrack[], audioLanguage: string | null): CaptionTrack | null {
  const preferredLanguages = ["en", ...(audioLanguage ? [baseLanguage(audioLanguage)] : [])];
  const languageRank = (track: CaptionTrack): number => {
    const rank = preferredLanguages.indexOf(baseLanguage(track.code));
    return rank === -1 ? preferredLanguages.length : rank;
  };
  const kindRank = (track: CaptionTrack): number => (track.kind === "uploaded" ? 0 : 1);
  const byPreference = (a: CaptionTrack, b: CaptionTrack): number =>
    languageRank(a) - languageRank(b) || kindRank(a) - kindRank(b) || a.code.length - b.code.length;
  return tracks.filter((track) => !isMachineTranslation(track)).toSorted(byPreference)[0] ?? null;
}

/** Every caption track the video has, or none when YouTube answered and the
 *  video has no captions. The addresses carry the PO token.
 *
 *  Success is judged by the tracks in the dump and never by the warnings,
 *  because a call that got the tracks can still print "HTTP Error 429" for a
 *  page it did not need. A call that got no tracks and whose output says
 *  YouTube was not reached throws YoutubeUnreachableError, and the proxy
 *  wrapper runs it again on a fresh connection until its tries run out. */
async function listCaptionTracks(video: YoutubeVideo): Promise<CaptionTrack[]> {
  return withResidentialProxy(
    video.url,
    async (proxyUrl) => {
      const { stdout, stderr } = await dumpVideoJson(video, proxyUrl);
      const tracks = stdout.trim() ? captionTracksFromDump(JSON.parse(stdout)) : [];
      if (tracks.length) return tracks;
      const unreachableLine = stderr.split("\n").find((line) => YOUTUBE_UNREACHABLE_RE.test(line));
      if (!unreachableLine) return [];
      throw new YoutubeUnreachableError(video.url, unreachableLine.trim().slice(0, MAX_REASON_LENGTH));
    },
    (err) => err instanceof YoutubeUnreachableError,
  );
}

/** The caption file's text, fetched through the residential proxy. When every
 *  try fails, YouTube was not reached, whatever the reason. */
async function downloadCaptionFile(videoUrl: string, track: CaptionTrack): Promise<string> {
  try {
    return await fetchTextViaResidentialProxy(track.url);
  } catch (err) {
    throw new YoutubeUnreachableError(videoUrl, hideProxyAddress(err instanceof Error ? err.message : String(err)).slice(0, MAX_REASON_LENGTH));
  }
}

/**
 * The video's captions as timestamped cues, or null when YouTube answered and
 * the video has no captions in its own language. When YouTube could not be
 * reached at all, this throws a YoutubeUnreachableError instead, so that a
 * proxy outage is never recorded as a video without captions (GOO-169).
 */
export async function fetchYoutubeCaptions(video: YoutubeVideo): Promise<SubtitleCue[] | null> {
  const track = chooseCaptionTrack(await listCaptionTracks(video), video.audioLanguage);
  if (!track) return null;
  const cues = parseSubtitleToCues(await downloadCaptionFile(video.url, track));
  return cues.length ? cues : null;
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
