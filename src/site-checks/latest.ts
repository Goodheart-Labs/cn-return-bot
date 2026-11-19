/** Prints the newest report of the daily site checks (GOO-804), which the
 *  services box saves in site_check_runs every night at 22:00 UTC. The
 *  devbox's CI checker Claude reads it this way every morning.
 *
 *    bun run site-checks-latest
 *
 *  It exits with 1 when last night's run saved no report, because then
 *  nothing was checked. */
import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";

/** The run starts at 22:00 UTC and the checker reads at 23:00 UTC. A report
 *  older than this is from the night before. */
const MAX_REPORT_AGE_HOURS = 20;
const MS_PER_HOUR = 3_600_000;

const { data, error } = await getSupabaseClient()
  .from("site_check_runs")
  .select("started_at, report")
  .order("started_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (error) throw new Error(`Reading the site checks failed: ${error.message}`);
if (!data) {
  console.log("The services box has never saved a report of the site checks.");
  process.exit(1);
}

const hoursAgo = (Date.now() - Date.parse(data.started_at)) / MS_PER_HOUR;
console.log(`This run started ${hoursAgo.toFixed(1)} hours ago on the services box.\n`);
console.log(data.report);
if (hoursAgo > MAX_REPORT_AGE_HOURS) {
  console.log(
    `\nThis report is more than ${MAX_REPORT_AGE_HOURS} hours old, so last night's run saved none. ` +
      "`journalctl -u cn-site-checks` on the services box shows why.",
  );
  process.exit(1);
}
