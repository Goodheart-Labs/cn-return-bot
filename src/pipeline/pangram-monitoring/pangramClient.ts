/**
 * The client for Pangram's AI-text-detection API. Version 3 of that API is
 * asynchronous. A classification is a task we create and then poll.
 *
 * 1. POST https://text.external-api.pangram.com/task  { text, public_dashboard_link }
 *      -> { task_id, stage }
 * 2. GET  https://text.external-api.pangram.com/task/{task_id}   (poll)
 *      -> { stage, prediction_short, fraction_ai, fraction_human, headline, dashboard_link, ... }
 *
 * We repeat the second call until `stage` reaches a final value. There are two
 * final values, STAGE_SUCCESS and STAGE_FAILED. Both calls send the API key in
 * the `x-api-key` header. Asking for `public_dashboard_link` makes the response
 * carry a shareable report URL of the form pangram.com/history/<id>, and that URL
 * is what our note cites as its source.
 */
import axios from "axios";

const PANGRAM_URL = "https://text.external-api.pangram.com/task";
const SUBMIT_RETRIES = 2;
const RETRY_BACKOFF_MS = 3000;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 90_000;

export type PangramVerdict =
  | {
      type: "classified";
      predictionShort: string; // One of "AI", "AI-Assisted", "Human" or "Mixed".
      fractionAi: number;
      fractionAiAssisted: number;
      fractionHuman: number;
      headline: string;
      dashboardLink: string; // The pangram.com/history/<id> report. Our note cites it.
      raw: unknown;
    }
  | { type: "error"; error: string };

function getApiKey(): string {
  const key = process.env.PANGRAM_API_KEY;
  if (!key) throw new Error("Missing required environment variable: PANGRAM_API_KEY");
  return key;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseSuccess(data: any): PangramVerdict {
  return {
    type: "classified",
    predictionShort: data?.prediction_short ?? "unknown",
    fractionAi: data?.fraction_ai ?? 0,
    fractionAiAssisted: data?.fraction_ai_assisted ?? 0,
    fractionHuman: data?.fraction_human ?? 0,
    headline: data?.headline ?? "",
    dashboardLink: data?.dashboard_link ?? "",
    raw: data,
  };
}

async function submitTask(text: string, headers: Record<string, string>): Promise<string> {
  for (let attempt = 0; attempt <= SUBMIT_RETRIES; attempt++) {
    try {
      const res = await axios.post(PANGRAM_URL, { text, public_dashboard_link: true }, { headers, timeout: 30_000 });
      const taskId = res.data?.task_id;
      if (!taskId) throw new Error(`no task_id in response: ${JSON.stringify(res.data)}`);
      return taskId;
    } catch (err: any) {
      const status = err?.response?.status;
      const retryable = status === 429 || status >= 500 || status === undefined;
      if (attempt < SUBMIT_RETRIES && retryable) {
        await sleep(RETRY_BACKOFF_MS * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error("exhausted submit retries");
}

async function pollTask(taskId: string, headers: Record<string, string>): Promise<PangramVerdict> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await axios.get(`${PANGRAM_URL}/${taskId}`, { headers, timeout: 30_000 });
    const stage = res.data?.stage;
    if (stage === "STAGE_SUCCESS") return parseSuccess(res.data);
    if (stage === "STAGE_FAILED") return { type: "error", error: `STAGE_FAILED: ${res.data?.headline ?? "unknown"}` };
    await sleep(POLL_INTERVAL_MS);
  }
  return { type: "error", error: `poll timeout after ${POLL_TIMEOUT_MS}ms` };
}

export async function classifyText(text: string): Promise<PangramVerdict> {
  try {
    const headers = { "x-api-key": getApiKey(), "Content-Type": "application/json" };
    const taskId = await submitTask(text, headers);
    return await pollTask(taskId, headers);
  } catch (err: any) {
    const status = err?.response?.status;
    const detail = err?.response?.data ? JSON.stringify(err.response.data) : err?.message;
    return { type: "error", error: `${status ?? "network"}: ${detail}` };
  }
}
