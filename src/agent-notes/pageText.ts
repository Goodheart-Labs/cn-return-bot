/* How GPT reads a page it opened: as numbered lines, one window at a time,
 * and by finding text in it. The page itself comes from the pipeline's fetch
 * ladder (webTools.ts). This file only cuts and searches the text, so it needs
 * no network. */

/** About 2,500 tokens. Enough to read a section in one go, small enough that a
 *  long page does not flood the conversation. */
export const WINDOW_CHARS = 10_000;
/** More matches than this means the text is too common to point anywhere. */
const MAX_MATCHES = 20;

export type PageLines = { url: string; lines: string[] };

/** The page's lines without the empty ones, so every number points at text. */
export function pageLines(url: string, text: string): PageLines {
  return { url, lines: text.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim() !== "") };
}

const numbered = (lines: string[], from: number) => lines.map((line, i) => `L${from + i}: ${line}`).join("\n");

/** The lines from `start` on, until the window is full. A single line longer
 *  than the window is cut, so the window always moves forward. */
export function pageWindow(page: PageLines, start: number): string {
  const total = page.lines.length;
  if (start >= total) return `${page.url} has ${total} lines, so there is no line ${start}.`;
  const shown: string[] = [];
  let chars = 0;
  for (let i = start; i < total && (shown.length === 0 || chars + page.lines[i]!.length <= WINDOW_CHARS); i++) {
    shown.push(page.lines[i]!.slice(0, WINDOW_CHARS));
    chars += page.lines[i]!.length;
  }
  const end = start + shown.length - 1;
  const more = end < total - 1 ? ` Open it again from line ${end + 1} to read on.` : "";
  return `${page.url}\nLines ${start} to ${end} of ${total}.${more}\n\n${numbered(shown, start)}`;
}

/** Case, runs of whitespace and curly quotes do not count, so a quote copied
 *  from a rendered page still matches the fetched text. */
const comparable = (text: string) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").toLowerCase();

/** Every line that contains the text, with the line before and after it. */
export function findInPage(page: PageLines, text: string): string {
  const wanted = comparable(text).trim();
  const hits = page.lines.flatMap((line, i) => (comparable(line).includes(wanted) ? [i] : []));
  if (hits.length === 0) return `"${text}" is not on ${page.url}.`;
  if (hits.length > MAX_MATCHES) return `"${text}" is on ${hits.length} lines of ${page.url}. Use a longer phrase.`;
  const matches = hits.map((i) => numbered(page.lines.slice(Math.max(0, i - 1), i + 2), Math.max(0, i - 1)));
  return `"${text}" is on ${hits.length} line${hits.length === 1 ? "" : "s"} of ${page.url}: ${hits.map((i) => `L${i}`).join(", ")}.\n\n${matches.join("\n\n")}`;
}
