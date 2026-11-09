/**
 * The client for Jina Reader (r.jina.ai), a hosted service that fetches a page
 * with its own browsers from its own addresses and returns the text as markdown.
 * readPage in readPage.ts asks it for a page only after every step of the free
 * fetch ladder has failed, and for an API answer only after a bot check stopped
 * both our plain request and our headless browser. It runs in the calling
 * service, not in the sandboxed fetcher, because it needs a key.
 *
 * In the GOO-167 investigation it recovered 230 of the 385 pages our ladder had
 * failed on in two weeks, including about half of the pages behind Cloudflare
 * and DataDome challenges (src/scripts_jim/2026_09_16_unfetchable_sources/).
 *
 * JINA_API_KEY must be set. Jina bills the tokens of the text it returns.
 */

import type { ApiAnswer } from "../../service/contract";
import { trackLlmCall } from "../cost-tracking/costTracker";
import { JINA_READER_USD_PER_MILLION_TOKENS } from "../cost-tracking/pricing";

/** Whether the page reader asks Jina Reader when every free step failed, for
 *  every caller alike: claim checks, reading a post for the queue, minisites
 *  and the walk's listings. Until 2026-11-09 it was an A/B test, jina_fetch,
 *  that was off (GOO-755). Where this is on and Jina is needed, a missing
 *  JINA_API_KEY throws. */
export const JINA_FALLBACK = true;

const JINA_READER_URL = "https://r.jina.ai/";
// Jina renders the page in a browser before it answers, so it needs longer than
// one of our plain HTTP steps.
const JINA_TIMEOUT_MS = 30_000;
const COST_NAME = "web_fetch.jina_reader";

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

// A 401 means the key is wrong and a 402 means the balance is used up. Both
// need a person to act, so they throw instead of passing as one failed step.
const ACCOUNT_ERROR_STATUSES = new Set([401, 402]);

export type JinaReaderResult =
  | { type: "page"; markdown: string }
  | { type: "target_error"; status: number }
  | { type: "challenge" }
  | { type: "failed"; status?: number; reason: string };

export class JinaAccountError extends Error {
  constructor(status: number, body: string) {
    super(`Jina Reader refused the API key (HTTP ${status}): ${body.slice(0, 200)}`);
    this.name = "JinaAccountError";
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
  usage?: { tokens?: number };
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
  const key = process.env.JINA_API_KEY;
  if (!key) throw new Error("JINA_API_KEY missing");

  let response: Response;
  try {
    response = await fetch(`${JINA_READER_URL}${target}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...extraHeaders },
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
    });
  } catch (err: any) {
    return { type: "failed", reason: err?.message?.slice(0, 200) ?? "network error" };
  }
  const text = await response.text();
  if (ACCOUNT_ERROR_STATUSES.has(response.status)) throw new JinaAccountError(response.status, text);
  if (!response.ok) return { type: "failed", status: response.status, reason: text.slice(0, 200) };

  const data = (JSON.parse(text) as JinaResponseBody).data ?? {};
  trackJinaCost(data.usage?.tokens ?? 0);
  return { type: "data", data };
}

function interpretJinaData(data: JinaData): JinaReaderResult {
  const targetError = data.warning?.match(TARGET_ERROR_WARNING);
  if (targetError) return { type: "target_error", status: Number(targetError[1]) };
  if (data.warning?.includes(CHALLENGE_WARNING)) return { type: "challenge" };
  const titleLine = data.title ? `# ${data.title}\n\n` : "";
  return { type: "page", markdown: titleLine + (data.content ?? "") };
}

/** Jina bills every answer it returns, a site's "page not found" page included,
 *  so the cost is recorded before the answer is judged. The tokens are Jina's,
 *  not a model's, so they stay out of the token counts and only the dollars are
 *  recorded. */
function trackJinaCost(tokens: number): void {
  trackLlmCall({
    name: COST_NAME,
    input_tokens: 0,
    output_tokens: 0,
    cost: (tokens / 1_000_000) * JINA_READER_USD_PER_MILLION_TOKENS,
    tools: [],
  });
}
