/** Runs the daily site checks and prints a Markdown report (GOO-804). The
 *  services box runs it every night at 22:00 UTC (ops/cn-site-checks.service)
 *  with --save, which stores the report in the table site_check_runs. The
 *  devbox's CI checker Claude reads it an hour later with
 *  `bun run site-checks-latest`.
 *
 *    bun run build-ext-dev && bun run site-checks [--save]
 *
 *  It needs the built extension and these variables: the services box's
 *  address and secret (EXTRACTION_URL, SERVICE_AUTH_SECRET), the YouTube
 *  Data API key, the Jina key, and for --save the database's service key.
 *  With the residential proxy (YTDLP_PROXY_URL) it opens YouTube's watch
 *  pages through the proxy; without it, those checks cannot run. It exits
 *  with 1 when any check failed. */
import "dotenv/config";
import type { BrowserContext } from "playwright";
import { getSupabaseClient } from "../api/supabaseClient";
import { launchWithExtension } from "../everything-extension/scripts/browser";
import { residentialProxyForBrowser } from "../pipeline/utils/residentialProxy";
import { extensionChecks, watchPageChecks } from "./extensionChecks";
import { serverChecks } from "./serverChecks";
import { CannotRunError, type SiteCheck } from "./siteCheck";

/** The slowest check reads a long video's captions through the proxy. */
const CHECK_TIMEOUT_MS = 180_000;
/** Live sites fail now and then for a moment, and Substack and the Wayback
 *  Machine slow down a burst of requests from one address. So a failed check
 *  gets one more try after this wait. */
const RETRY_AFTER_MS = 60_000;
/** Thumbnails and channel pictures, which no watch-page check looks at. The
 *  proxy is paid per gigabyte, so the proxied browser does not load them. */
const IMAGES_NOBODY_CHECKS = /ytimg\.com|ggpht\.com/;
const BYTES_PER_MB = 1e6;

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

/** Launches the browser with the extension, hands it to `use`, and closes it. */
async function withBrowser<T>(proxy: Parameters<typeof launchWithExtension>[0], use: (context: BrowserContext) => Promise<T>): Promise<T> {
  const context = await launchWithExtension(proxy);
  try {
    return await use(context);
  } finally {
    await context.close();
  }
}

/** Runs the watch-page checks in a browser that goes through the residential
 *  proxy, and measures how much traffic the proxy carried for them. */
async function runWatchPageChecks(): Promise<{ results: CheckResult[]; proxiedBytes: number | null }> {
  const proxy = residentialProxyForBrowser();
  let proxiedBytes = 0;
  const results = await withBrowser(proxy, async (context) => {
    if (proxy) {
      await context.route(IMAGES_NOBODY_CHECKS, (route) => route.abort());
      context.on("requestfinished", (request) => {
        request.sizes().then((sizes) => (proxiedBytes += sizes.responseHeadersSize + sizes.responseBodySize), () => {});
      });
    }
    return runAll(watchPageChecks(context));
  });
  return { results, proxiedBytes: proxy ? proxiedBytes : null };
}

function report(results: CheckResult[], startedAt: Date, proxiedBytes: number | null): string {
  const withOutcome = (outcome: Attempt["outcome"]) => results.filter((result) => result.outcome === outcome);
  const failed = withOutcome("failed");
  const cannotRun = withOutcome("cannot_run");
  const passed = withOutcome("passed");
  const lines = [
    `# Site checks, ${startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    `${passed.length} of ${results.length} checks passed, ${failed.length} failed, and ${cannotRun.length} could not run from this machine.`,
  ];
  if (proxiedBytes !== null) lines.push("", `The YouTube watch pages took ${(proxiedBytes / BYTES_PER_MB).toFixed(1)} MB of the residential proxy's paid traffic.`);
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

/** Stores the run in site_check_runs, one row per run, for the CI checker. */
async function saveRun(results: CheckResult[], startedAt: Date, markdown: string): Promise<void> {
  const count = (outcome: Attempt["outcome"]) => results.filter((result) => result.outcome === outcome).length;
  const { error } = await getSupabaseClient()
    .from("site_check_runs")
    .insert({
      started_at: startedAt.toISOString(),
      passed: count("passed"),
      failed: count("failed"),
      cannot_run: count("cannot_run"),
      report: markdown,
      results: results.map(({ check, outcome, retried, ...detail }) => ({
        site: check.site,
        name: check.name,
        outcome,
        retried,
        detail: "saw" in detail ? detail.saw : detail.reason,
      })),
    });
  if (error) throw new Error(`Saving the site checks failed: ${error.message}`);
}

const startedAt = new Date();
const results = await runAll(serverChecks);
results.push(...(await withBrowser(undefined, (context) => runAll(extensionChecks(context)))));
const watchPages = await runWatchPageChecks();
results.push(...watchPages.results);
const markdown = report(results, startedAt, watchPages.proxiedBytes);
console.log(markdown);
if (process.argv.includes("--save")) await saveRun(results, startedAt, markdown);
if (results.some((result) => result.outcome === "failed")) process.exit(1);
