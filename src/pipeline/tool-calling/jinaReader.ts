/**
 * The client for Jina Reader (r.jina.ai), a hosted service that fetches a page
 * with its own browsers from its own addresses and returns the text as markdown.
 * The fetch ladder in tools.ts asks it only after every one of its own steps
 * has failed.
 *
 * In the GOO-167 investigation it recovered 230 of the 385 pages our ladder had
 * failed on in two weeks, including about half of the pages behind Cloudflare
 * and DataDome challenges (src/scripts_jim/2026_09_16_unfetchable_sources/).
 *
 * JINA_API_KEY must be set. Jina bills the tokens of the text it returns.
 */

import { trackLlmCall } from "../cost-tracking/costTracker";
import { JINA_READER_USD_PER_MILLION_TOKENS } from "../cost-tracking/pricing";

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
  data?: {
    title?: string;
    content?: string;
    warning?: string;
    usage?: { tokens?: number };
  };
}

export async function fetchWithJinaReader(url: string): Promise<JinaReaderResult> {
  const key = process.env.JINA_API_KEY;
  if (!key) throw new Error("JINA_API_KEY missing");

  let response: Response;
  try {
    response = await fetch(`${JINA_READER_URL}${url}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
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
  return interpretJinaData(data);
}

function interpretJinaData(data: NonNullable<JinaResponseBody["data"]>): JinaReaderResult {
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
