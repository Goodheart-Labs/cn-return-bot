/** Runs the daily site checks and prints a Markdown report (GOO-804). The
 *  devbox's daily-ci-report runs it every morning right before the CI checker
 *  Claude starts, and that Claude reads the report.
 *
 *    bun run build-ext-dev && bun run site-checks
 *
 *  It needs the built extension and the root .env, with the services box's
 *  address and secret (EXTRACTION_URL, SERVICE_AUTH_SECRET), the YouTube
 *  Data API key and the Jina key. It exits with 1 when any check failed. */
import "dotenv/config";
import { launchWithExtension } from "../everything-extension/scripts/browser";
import { extensionChecks } from "./extensionChecks";
import { serverChecks } from "./serverChecks";
import { CannotRunError, type SiteCheck } from "./siteCheck";

/** The slowest check reads a long video's captions through the proxy. */
const CHECK_TIMEOUT_MS = 180_000;
/** Live sites fail now and then for a moment, and Substack and the Wayback
 *  Machine slow down a burst of requests from one address. So a failed check
 *  gets one more try after this wait. */
const RETRY_AFTER_MS = 60_000;

type Attempt = { outcome: "passed"; saw: string } | { outcome: "failed" | "cannot_run"; reason: string };
type CheckResult = Attempt & { check: SiteCheck; retried: boolean };

async function attempt(check: SiteCheck): Promise<Attempt> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${CHECK_TIMEOUT_MS / 1000} seconds`)), CHECK_TIMEOUT_MS);
  });
  // Each check is independent, so a failure is recorded and the other checks
  // still run. The run as a whole fails at the end.
  try {
    return { outcome: "passed", saw: await Promise.race([check.run(), timeout]) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { outcome: err instanceof CannotRunError ? "cannot_run" : "failed", reason };
  } finally {
    clearTimeout(timer);
  }
}

async function runCheck(check: SiteCheck): Promise<CheckResult> {
  const first = await attempt(check);
  if (first.outcome !== "failed") return { ...first, check, retried: false };
  await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
  return { ...(await attempt(check)), check, retried: true };
}

async function runAll(checks: SiteCheck[]): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    const result = await runCheck(check);
    console.error(`${result.outcome}${result.retried ? " after a retry" : ""}: ${check.site}: ${check.name}`);
    results.push(result);
  }
  return results;
}

function report(results: CheckResult[], startedAt: Date): string {
  const withOutcome = (outcome: Attempt["outcome"]) => results.filter((result) => result.outcome === outcome);
  const failed = withOutcome("failed");
  const cannotRun = withOutcome("cannot_run");
  const passed = withOutcome("passed");
  const lines = [
    `# Site checks, ${startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    `${passed.length} of ${results.length} checks passed, ${failed.length} failed, and ${cannotRun.length} could not run from the devbox.`,
  ];
  const section = (title: string, sectionResults: CheckResult[], describe: (result: CheckResult) => string[]) => {
    if (sectionResults.length > 0) lines.push("", `## ${title}`, "", ...sectionResults.flatMap(describe));
  };
  const reason = (result: CheckResult) => (result.outcome === "passed" ? result.saw : result.reason);
  section("Failed", failed, (result) => [`- **${result.check.site}: ${result.check.name}.** ${reason(result)}`, `  Code: ${result.check.code}`]);
  section("Could not run", cannotRun, (result) => [`- ${result.check.site}: ${result.check.name}. ${reason(result)}`]);
  section("Passed", passed, (result) => [
    `- ${result.check.site}: ${result.check.name}. ${reason(result)}${result.retried ? " (Passed only on the second try.)" : ""}`,
  ]);
  return lines.join("\n");
}

const startedAt = new Date();
const results = await runAll(serverChecks);
const browser = await launchWithExtension();
try {
  results.push(...(await runAll(extensionChecks(browser))));
} finally {
  await browser.close();
}
console.log(report(results, startedAt));
if (results.some((result) => result.outcome === "failed")) process.exit(1);
