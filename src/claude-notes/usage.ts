/* Reads how much of Jim's Claude Code plan is used (GOO-507), so the note
 * writer can keep its share of the weekly limit in check. It asks the same
 * endpoint Claude Code's /usage screen reads, with the login Claude Code keeps
 * on this machine, and appends every reading to a log so the trend can be
 * estimated. */

import { appendFileSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import * as path from "path";

const CREDENTIALS_PATH = path.join(homedir(), ".claude/.credentials.json");
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
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

export async function readUsage(): Promise<UsageReading> {
  const { accessToken } = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8")).claudeAiOauth;
  const response = await fetch(USAGE_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
  });
  if (!response.ok) throw new Error(`The usage endpoint answered ${response.status}: ${await response.text()}`);
  const body: { seven_day: Window } = await response.json();
  const reading: UsageReading = {
    at: new Date().toISOString(),
    weekly: body.seven_day.utilization,
    weeklyResetsAt: body.seven_day.resets_at,
  };
  mkdirSync(path.dirname(USAGE_LOG_PATH), { recursive: true });
  appendFileSync(USAGE_LOG_PATH, `${JSON.stringify(reading)}\n`);
  return reading;
}
