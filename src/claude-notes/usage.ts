/* Reads how much of the notewriter's Claude Code plan is used (GOO-507), so
 * the note writer can keep its share of the weekly limit in check. It asks the
 * same endpoint Claude Code's /usage screen reads, with the login Claude Code
 * keeps in its config folder, and appends every reading to a log so the trend
 * can be estimated. The config folder is CLAUDE_CONFIG_DIR when it is set: on
 * the ai-box that is the folder of Jim's notewriter account (GOO-787), so the
 * runner never uses Nathan's own login. */

import { appendFileSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import * as path from "path";

const CREDENTIALS_PATH = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"), ".credentials.json");
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";

const USAGE_LOG_PATH = path.join(homedir(), ".local/share/claude-note-finder/usage.jsonl");

interface Window {
  utilization: number;
  resets_at: string;
}

export interface UsageReading {
  at: string;
  /** Percent of the weekly limit, which is what the note writer budgets. */
  weekly: number;
  weeklyResetsAt: string;
}

/** The reading in the rate-limit headers of an inference response: the same
 *  meter as the usage endpoint, as a fraction and an epoch second. */
export function readingFromHeaders(headers: Headers, at: Date): UsageReading {
  const used = headers.get("anthropic-ratelimit-unified-7d-utilization");
  const reset = headers.get("anthropic-ratelimit-unified-7d-reset");
  if (!used || !reset) throw new Error("The inference response carried no weekly usage headers");
  return { at: at.toISOString(), weekly: Number(used) * 100, weeklyResetsAt: new Date(Number(reset) * 1000).toISOString() };
}

/** A `claude setup-token` login may only run inference, so the usage endpoint
 *  refuses it (403, then 429 for an hour). One output token of Haiku brings
 *  the same meter back in its headers, also when the plan is used up (429). */
async function readUsageFromInference(accessToken: string): Promise<UsageReading> {
  const response = await fetch(MESSAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1,
      system: "You are Claude Code, Anthropic's official CLI for Claude.",
      messages: [{ role: "user", content: "." }],
    }),
  });
  if (!response.ok && response.status !== 429) {
    throw new Error(`The usage endpoint answered ${response.status}: ${await response.text()}`);
  }
  return readingFromHeaders(response.headers, new Date());
}

async function readUsageFromEndpoint(accessToken: string): Promise<UsageReading> {
  const response = await fetch(USAGE_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
  });
  if (!response.ok) throw new Error(`The usage endpoint answered ${response.status}: ${await response.text()}`);
  const body: { seven_day: Window } = await response.json();
  return { at: new Date().toISOString(), weekly: body.seven_day.utilization, weeklyResetsAt: body.seven_day.resets_at };
}

export async function readUsage(): Promise<UsageReading> {
  const { accessToken, refreshToken } = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8")).claudeAiOauth;
  // Only a setup-token login has no refresh token.
  const reading = await (refreshToken ? readUsageFromEndpoint(accessToken) : readUsageFromInference(accessToken));
  mkdirSync(path.dirname(USAGE_LOG_PATH), { recursive: true });
  appendFileSync(USAGE_LOG_PATH, `${JSON.stringify(reading)}\n`);
  return reading;
}
