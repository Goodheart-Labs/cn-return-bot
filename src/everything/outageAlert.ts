/**
 * Emails Nathan when the checker is broken for every item, not just for one.
 *
 * A failed feed run goes red in the Actions list, and nobody watches that list.
 * From 16 to 19 October 2026 the OpenRouter key of the machine's extraction
 * service sat at its monthly limit. 695 items failed, the feed workflow went
 * red 189 times in one day, and nobody noticed for three days. So a breakage
 * of the whole system also sends an email.
 *
 * Three things count as such a breakage:
 *  - an item error saying a provider account is out of credit, quota or
 *    permission. It is emailed at the first item, because nothing but a person
 *    fixes it;
 *  - the same error, with links and ids taken out, on each of the last five
 *    items either worker finished;
 *  - the machine failing the feed run's health check.
 * A failure that belongs to one item, such as a young video without captions,
 * sends nothing.
 *
 * Each distinct error is emailed at most once every 12 hours, remembered in
 * pipeline_state. An alert never changes how the run ends: whatever goes wrong
 * while alerting is logged and dropped.
 */

import {
  fetchErroredItemsSince,
  fetchLastFinishedItems,
  fetchPipelineState,
  savePipelineState,
  type FinishedItem,
} from "./db";
import { clip } from "./logFormat";

/** How many finished items in a row must fail with the same error before it
 *  counts as a breakage. */
export const OUTAGE_STREAK = 5;

/** The same error is emailed at most this often. */
export const ALERT_EVERY_HOURS = 12;

/** The pipeline_state key that holds when each error was last emailed: JSON
 *  from error signature to ISO time. */
const ALERT_STATE_KEY = "everything_outage_alerts";

/** How far back the email looks for the first item that failed the same way. */
const FIRST_SEEN_LOOKBACK_DAYS = 7;

const RESEND_URL = "https://api.resend.com/emails";
const ALERT_FROM = "Common Notes alerts <notes@commonnotes.net>";
const ALERT_TO = "nathan@goodheartlabs.com";
const SEND_TIMEOUT_MS = 15_000;

const SIGNATURE_LENGTH = 200;
const EMAIL_ERROR_LENGTH = 1500;
const HOUR_MS = 3600_000;

const URL_PATTERN = /https?:\/\/[^\s"'<>\\)]+/gi;

/** Errors that belong to one item and never to the system. Young videos
 *  without captions often fail several in a row (six on 17 October 2026), so
 *  the streak rule alone would take them for an outage. */
const ONE_OFF_ERRORS = [/no transcript available/i, /no captions/i, /age-restricted/i, /premiere that has not aired/i];

/** Errors that mean a provider account is out of credit, quota or permission.
 *  A bare 401 or 402 counts only on a model call, written by llm.ts as
 *  "[model: x] 402 ...". A web page answering 401 or 402 is one paywalled
 *  page. */
const ACCOUNT_PROBLEMS: { pattern: RegExp; problem: string }[] = [
  { pattern: /key limit|monthly limit|credit limit|spend(ing)? limit/i, problem: "key limit" },
  { pattern: /insufficient[ _](credits|funds|balance)|requires more credits|out of credits|\[model: [^\]]*\] 402\b/i, problem: "out of credits" },
  { pattern: /quota[ _]?exceeded|exceeded (your|the) [^.]{0,60}quota|insufficient_quota/i, problem: "quota exceeded" },
  {
    pattern: /invalid[ _]api[ _]key|incorrect api key|api key (is )?(invalid|expired|revoked|not valid)|no auth credentials|\[model: [^\]]*\] 401\b/i,
    problem: "API key rejected",
  },
  { pattern: /user_blocked|account (has been |is )?(suspended|disabled|blocked|deactivated)/i, problem: "account blocked" },
  { pattern: /billing/i, problem: "billing problem" },
];

export interface Outage {
  kind: "account" | "repeated" | "machine";
  /** What broke, for the subject line, such as "OpenRouter key limit". */
  label: string;
  /** The error text as it was recorded. */
  error: string;
  signature: string;
}

/** The error with everything that differs between items taken out: links,
 *  times, ids, amounts, durations and long numbers. Status codes stay. Two
 *  items that failed for the same reason get the same signature. */
export function errorSignature(error: string): string {
  return error
    .replace(URL_PATTERN, "<url>")
    .replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, "<time>")
    .replace(/\$\d[\d,]*(?:\.\d+)?/g, "$<amount>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<id>")
    .replace(/\[youtube\] [\w-]{11}:/g, "[youtube] <id>:")
    .replace(/\b(?=\w*\d)(?=\w*[a-z])\w{10,}\b/gi, "<id>")
    .replace(/\b\d+(?:ms|s|m|h|d)(?:\d+(?:ms|s|m|h|d))*\b/g, "<duration>")
    .replace(/\d{4,}/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SIGNATURE_LENGTH);
}

/** Every model call goes through OpenRouter, so a "[model: x]" error is
 *  OpenRouter's too. */
function providerOf(error: string): string | null {
  if (/openrouter|\[model: /i.test(error)) return "OpenRouter";
  if (/youtube data api/i.test(error)) return "YouTube Data API";
  return null;
}

/** Names the provider account problem an error reports, such as "OpenRouter
 *  key limit", or null when it reports none. Links are taken out first, so a
 *  page whose address says "billing" is not one. */
export function accountProblem(error: string): string | null {
  const withoutLinks = error.replace(URL_PATTERN, "<url>");
  const match = ACCOUNT_PROBLEMS.find(({ pattern }) => pattern.test(withoutLinks));
  if (!match) return null;
  const provider = providerOf(error);
  return provider ? `${provider} ${match.problem}` : match.problem;
}

export const isOneOffItemError = (error: string): boolean => ONE_OFF_ERRORS.some((pattern) => pattern.test(error));

/** Judges the last finished items, newest first, after an item failed. The
 *  newest error among them is this run's, since it was written a moment ago. */
export function judgeItemErrors(recent: FinishedItem[]): Outage | null {
  const error = recent.find((item) => item.status === "error" && item.error)?.error;
  if (!error) return null;
  const signature = errorSignature(error);
  const problem = accountProblem(error);
  if (problem) return { kind: "account", label: problem, error, signature };
  if (isOneOffItemError(error)) return null;
  const streak =
    recent.length >= OUTAGE_STREAK &&
    recent
      .slice(0, OUTAGE_STREAK)
      .every((item) => item.status === "error" && item.error !== null && errorSignature(item.error) === signature);
  return streak ? { kind: "repeated", label: `the same error on the last ${OUTAGE_STREAK} items`, error, signature } : null;
}

export const machineOutage = (error: string): Outage => ({
  kind: "machine",
  label: "services machine unhealthy",
  error,
  signature: errorSignature(error),
});

/** When each error signature was last emailed. */
export type AlertLog = Record<string, string>;

export function parseAlertLog(raw: string | null): AlertLog {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as AlertLog) : {};
  } catch {
    return {};
  }
}

export function alertIsDue(sent: AlertLog, signature: string, now: Date): boolean {
  const last = Date.parse(sent[signature] ?? "");
  return Number.isNaN(last) || now.getTime() - last >= ALERT_EVERY_HOURS * HOUR_MS;
}

/** The log with this email added. Entries old enough to be due again are
 *  dropped, so the stored value never grows. */
export function recordAlert(sent: AlertLog, signature: string, now: Date): AlertLog {
  const recent = Object.entries(sent).filter(([other]) => !alertIsDue(sent, other, now));
  return { ...Object.fromEntries(recent), [signature]: now.toISOString() };
}

export interface FailureTally {
  /** Items in error with the signature whose last attempt was in the last 24 hours. */
  last24h: number;
  /** When the oldest of them still in error failed, within the lookback. */
  firstSeen: string | null;
}

export function tallyFailures(items: { error: string | null; processed_at: string }[], signature: string, now: Date): FailureTally {
  const matching = items.filter((item) => item.error !== null && errorSignature(item.error) === signature);
  const dayAgo = now.getTime() - 24 * HOUR_MS;
  return {
    last24h: matching.filter((item) => Date.parse(item.processed_at) >= dayAgo).length,
    firstSeen: matching.map((item) => item.processed_at).sort()[0] ?? null,
  };
}

export function actionsRunUrl(env: Record<string, string | undefined>): string | null {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = env;
  return GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
    ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
    : null;
}

/** The OpenRouter page an error links to, where its key's limit is raised. */
export const openRouterLink = (error: string): string | null =>
  error.match(/https:\/\/openrouter\.ai\/[^\s"'<>\\)]+/)?.[0].replace(/[.,;:]+$/, "") ?? null;

const formatUtc = (iso: string): string => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;

const WHAT_BROKE: Record<Outage["kind"], (outage: Outage) => string> = {
  account: (outage) => `${outage.label}: every item that needs it fails until someone fixes the account.`,
  repeated: () => `The last ${OUTAGE_STREAK} items the checker finished all failed with the same error.`,
  machine: () => "The services machine failed the feed run's health check, so feed runs stop before taking an item.",
};

export function composeAlertEmail(
  outage: Outage,
  context: { failures: FailureTally | null; runUrl: string | null },
): { subject: string; text: string } {
  const details: string[] = [];
  const { failures } = context;
  if (failures) {
    const first = failures.firstSeen ? `, the first at ${formatUtc(failures.firstSeen)}` : "";
    details.push(`Items failed with this error in the last 24 hours: ${failures.last24h}${first}.`);
  }
  if (context.runUrl) details.push(`Actions run: ${context.runUrl}`);
  const keyPage = outage.kind === "account" ? openRouterLink(outage.error) : null;
  if (keyPage) details.push(`OpenRouter key: ${keyPage}`);
  const lines = [
    WHAT_BROKE[outage.kind](outage),
    "",
    "Error:",
    clip(outage.error, EMAIL_ERROR_LENGTH),
    ...(details.length > 0 ? ["", ...details] : []),
    "",
    `The same error is not emailed again for ${ALERT_EVERY_HOURS} hours.`,
  ];
  return { subject: `Common Notes checker down: ${outage.label}`, text: lines.join("\n") };
}

let warnedAboutMissingKey = false;

/** Emails the outage unless the same error was emailed in the last 12 hours. */
async function sendOutageAlert(outage: Outage): Promise<void> {
  console.log(`\nOUTAGE · ${outage.label} · ${clip(outage.error, 160)}`);
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (!warnedAboutMissingKey) console.warn("  RESEND_API_KEY is not set, so no email is sent");
    warnedAboutMissingKey = true;
    return;
  }
  const now = new Date();
  const sent = parseAlertLog(await fetchPipelineState(ALERT_STATE_KEY));
  if (!alertIsDue(sent, outage.signature, now)) {
    console.log(`  already emailed at ${sent[outage.signature]}, and the same error is emailed at most every ${ALERT_EVERY_HOURS} hours`);
    return;
  }
  const failures =
    outage.kind === "machine"
      ? null
      : tallyFailures(await fetchErroredItemsSince(new Date(now.getTime() - FIRST_SEEN_LOOKBACK_DAYS * 24 * HOUR_MS)), outage.signature, now);
  const email = composeAlertEmail(outage, { failures, runUrl: actionsRunUrl(process.env) });
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: ALERT_FROM, to: [ALERT_TO], subject: email.subject, text: email.text }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Resend answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  await savePipelineState(ALERT_STATE_KEY, JSON.stringify(recordAlert(sent, outage.signature, now)));
  console.log(`  emailed ${ALERT_TO}: ${email.subject}`);
}

/** Runs an alert and swallows anything it throws, so alerting never changes
 *  how the run ends. */
async function alertSafely(alert: () => Promise<void>): Promise<void> {
  try {
    await alert();
  } catch (err: any) {
    console.warn(`[outage alert] could not alert: ${err?.message ?? err}`);
  }
}

/** Called after the feed run's item failed. Emails when the failure looks like
 *  a breakage of the whole system rather than of the one item. */
export async function alertIfItemsAreFailing(): Promise<void> {
  await alertSafely(async () => {
    const outage = judgeItemErrors(await fetchLastFinishedItems(OUTAGE_STREAK));
    if (outage) await sendOutageAlert(outage);
  });
}

/** Called when the machine failed the health check. That is always a
 *  breakage: no feed item runs until the machine is well again. */
export async function alertOnSickMachine(err: unknown): Promise<void> {
  await alertSafely(() => sendOutageAlert(machineOutage(err instanceof Error ? err.message : String(err))));
}
