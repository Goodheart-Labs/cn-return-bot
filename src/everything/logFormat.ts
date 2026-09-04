/**
 * Formatting for the everything pipeline's run log (GOO-107).
 *
 * The log is read in two places: a GitHub Actions run page, and a terminal
 * during a local run. On Actions a `::group::` marker makes everything up to
 * the matching `::endgroup::` collapsible, which is how the X pipeline already
 * prints its full per-tweet log (see formatTweetLogFull in
 * src/pipeline/utils/tweetLog.ts). Locally those markers are noise, so they
 * become a plain header line instead.
 *
 * The rule the sections follow: every count says what period it covers. A
 * number with no window cannot be read, because there is no way to tell whether
 * "2 requests" means this cycle, today, or since we started.
 */

const onCi = (): boolean => !!process.env.CI;

/** Renders `lines` under `label`, collapsed on CI and plainly indented
 *  locally. An empty body renders nothing at all, so a section that had
 *  nothing to say leaves no trace. */
export function group(label: string, lines: string[]): string {
  if (lines.length === 0) return "";
  const body = lines.join("\n");
  if (onCi()) return `::group::${label}\n${body}\n::endgroup::`;
  return `  ${label}\n${body}`;
}

/** Pads every column to its widest cell so a table reads down its columns.
 *  `align` marks the columns whose values are numbers and should sit right. */
export function table(headers: string[], rows: string[][], align: ("left" | "right")[] = []): string[] {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const render = (cells: string[]) =>
    "     " +
    cells
      .map((c, i) => (align[i] === "right" ? c.padStart(widths[i]!) : c.padEnd(widths[i]!)))
      .join("  ")
      .trimEnd();
  return [render(headers), ...rows.map(render)];
}

/** "3m12s", "45s", "1h04m". Durations in this pipeline run from seconds to
 *  hours, so hours and minutes are the only units worth having. */
export function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m${String(total % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

/** How long ago a timestamp was, in the same units as `duration`. */
export function age(since: string): string {
  return duration(Date.now() - Date.parse(since));
}

/** "$2.14". Costs here are small and two decimals is the resolution the spend
 *  cap is written in. */
export const money = (usd: number): string => `$${usd.toFixed(2)}`;

/** "1st", "2nd", "13th". Used for a queue position, which reads better as an
 *  ordinal than as a bare index. */
export function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** Shortens a title to fit a column without cutting mid-word where it can be
 *  helped. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Counts rendered as "slowboring 16, natesilver 7", biggest first. Used where
 *  a per-creator tally would otherwise be one line each. */
export function tally(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${name} ${n}`)
    .join(", ");
}
