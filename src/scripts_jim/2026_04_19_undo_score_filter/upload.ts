/**
 * Upload one or more results CSVs to the prod review-dashboard and open each
 * in a new browser tab. Used after undo_filter.py rewrites the CSVs.
 *
 * Usage: bun run src/scripts_jim/2026_04_19_undo_score_filter/upload.ts <name>=<csv> ...
 */
import "dotenv/config";
// Capture prod creds BEFORE any remap (there's no remap here, but consistent).
import "../../local/prodSupabaseCreds";
import { autoOpenInDashboard } from "../../local/dashboardAutoOpen";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: upload.ts <name>=<csv> [...more]");
    process.exit(1);
  }
  for (const arg of args) {
    const eq = arg.indexOf("=");
    if (eq === -1) {
      console.error(`bad arg (expected name=csv): ${arg}`);
      process.exit(1);
    }
    const name = arg.slice(0, eq);
    const csv = arg.slice(eq + 1);
    console.log(`uploading ${name} ← ${csv}`);
    await autoOpenInDashboard(csv, name);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
