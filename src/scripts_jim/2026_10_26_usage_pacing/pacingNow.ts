/* Prints what the usage pacing would decide right now from prod's readings,
 * read-only, so the interval can be checked before the change ships. */
import "dotenv/config";
import { fetchUsageSnapshot } from "../../everything/db";
import { computeClaudePacing, describeClaudePacing } from "../../everything/usagePacing";

const snapshot = await fetchUsageSnapshot();
console.log(describeClaudePacing(computeClaudePacing(snapshot), snapshot));
