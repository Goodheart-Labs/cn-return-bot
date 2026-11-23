/**
 * The client for Jina Reader, the open-source page reader of Jina AI. It fetches
 * a page with curl-impersonate or its own headless Chrome and returns the text
 * as markdown. We run it in Docker on the services box (ops/cn-jina-reader.service,
 * GOO-853). It first fetches from the box's own address, and fetches the page's
 * HTML once more through the residential proxy when that fails.
 *
 * readPage in readPage.ts asks it for a page only after every step of the free
 * fetch ladder has failed, and for an API answer only after a bot check stopped
 * both our plain request and our headless browser.
 *
 * Until GOO-853 we paid for Jina's hosted copy at r.jina.ai. In the GOO-167
 * investigation that copy recovered 230 of the 385 pages our ladder had failed
 * on in two weeks (src/scripts_jim/2026_09_16_unfetchable_sources/). The
 * self-hosted copy was compared with it on the read log of GOO-766
 * (src/scripts_jim/2026_11_23_self_hosted_jina/).
 */

import type { ApiAnswer } from "../../service/contract";

/** Whether the page reader asks Jina Reader when every free step failed, for
 *  every caller alike: claim checks, reading a post for the queue, minisites
 *  and the walk's listings. Until 2026-11-09 it was an A/B test, jina_fetch,
 *  that was off (GOO-755). */
export const JINA_FALLBACK = true;

/** cn-jina-reader's port on the services box. On another machine, run the
 *  same image on this port to read pages through Jina (ops/README.md). */
const JINA_READER_URL = "http://127.0.0.1:8789/";
// Jina renders the page in a browser before it answers, and it may fetch the
// page a second time through the proxy, so it needs longer than one of our
// plain HTTP steps.
const JINA_TIMEOUT_MS = 30_000;

// Jina answers 200 even when the site behind it refused. It says so in a
// warning field. "Target URL returned error 404: Not Found" carries the site's
// own status. The CAPTCHA warning means Jina met a bot challenge it could not
// pass. Other warnings, such as "cached snapshot" or "not yet fully loaded",
// come with usable text and are left to the ladder's normal length check.
const TARGET_ERROR_WARNING = /^Target URL returned error (\d{3})/;
const CHALLENGE_WARNING = "CAPTCHA";

/** A site that answers Jina's own plain request with one of these statuses is
 *  showing a bot check, as the EA Forum's Vercel Security Checkpoint does
 *  with 429. */
const BOT_CHECK_STATUSES = new Set([403, 429]);

/** What makes Jina hand back an API answer unchanged. With the text format,
 *  Jina returns the body as its browser shows it, and a browser shows a JSON
 *  answer as the JSON itself. Without the no-cache header Jina may answer with
 *  a copy it fetched earlier, and an API answer changes. */
const API_HEADERS = { "X-Return-Format": "text", "X-No-Cache": "true" };

export type JinaReaderResult =
  | { type: "page"; markdown: string }
  | { type: "target_error"; status: number }
  | { type: "challenge" }
  | { type: "failed"; status?: number; reason: string };

/** Thrown when nothing answers on Jina's port. Then the container is down,
 *  and a person has to look, so this is not one failed step of one read. */
export class JinaUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Jina Reader is not running at ${JINA_READER_URL}`, { cause });
    this.name = "JinaUnavailableError";
  }
}

interface JinaResponseBody {
  data?: JinaData;
}

interface JinaData {
  title?: string;
  content?: string;
  /** The body, when the request asked for the text format. */
  text?: string;
  warning?: string;
}

type JinaAnswer = { type: "data"; data: JinaData } | { type: "failed"; status?: number; reason: string };

export async function fetchWithJinaReader(url: string): Promise<JinaReaderResult> {
  const answer = await askJina(url, {});
  return answer.type === "data" ? interpretJinaData(answer.data) : answer;
}

/** Reads an API answer through Jina, such as a forum's GraphQL query sent as
 *  a GET request. */
export async function fetchApiWithJina(address: string): Promise<ApiAnswer> {
  const answer = await askJina(address, API_HEADERS);
  if (answer.type === "failed") return { type: "failed", reason: `Jina: ${answer.status ? `HTTP ${answer.status}` : answer.reason}` };
  const { data } = answer;
  const targetStatus = Number(data.warning?.match(TARGET_ERROR_WARNING)?.[1] ?? 0);
  if (data.warning?.includes(CHALLENGE_WARNING) || BOT_CHECK_STATUSES.has(targetStatus)) return { type: "bot_check" };
  if (targetStatus) return { type: "failed", reason: `Jina: the site answered HTTP ${targetStatus}` };
  return { type: "answer", body: data.text ?? "" };
}

async function askJina(target: string, extraHeaders: Record<string, string>): Promise<JinaAnswer> {
  let response: Response;
  try {
    response = await fetch(`${JINA_READER_URL}${target}`, {
      headers: { Accept: "application/json", ...extraHeaders },
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
    });
  } catch (err: any) {
    if (err?.code === "ECONNREFUSED") throw new JinaUnavailableError(err);
    return { type: "failed", reason: err?.message?.slice(0, 200) ?? "network error" };
  }
  const text = await response.text();
  if (!response.ok) return { type: "failed", status: response.status, reason: text.slice(0, 200) };
  return { type: "data", data: (JSON.parse(text) as JinaResponseBody).data ?? {} };
}

function interpretJinaData(data: JinaData): JinaReaderResult {
  const targetError = data.warning?.match(TARGET_ERROR_WARNING);
  if (targetError) return { type: "target_error", status: Number(targetError[1]) };
  if (data.warning?.includes(CHALLENGE_WARNING)) return { type: "challenge" };
  const titleLine = data.title ? `# ${data.title}\n\n` : "";
  return { type: "page", markdown: titleLine + (data.content ?? "") };
}
