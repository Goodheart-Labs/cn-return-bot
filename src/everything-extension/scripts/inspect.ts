// Prints the DOM under a selector on a live page, with the freshly built
// extension loaded. This is how a session on the headless devbox answers
// "what does Substack's markup actually look like there?" before writing
// selectors against it.
//
//   bun run src/everything-extension/scripts/inspect.ts <url> <selector> [--limit N] [--depth N] [--html]
//
// The default output is a condensed tree: one line per element with its tag,
// id, role, data-testid, href, and the start of its class list and text.
// --html prints trimmed outerHTML instead.
import { openPageWithExtension } from "./browser";

const DEFAULT_MATCH_LIMIT = 3;
const DEFAULT_TREE_DEPTH = 6;
const HTML_CHAR_LIMIT = 4000;
const SETTLE_MS = 4000;

const [url, selector, ...rest] = process.argv.slice(2);
if (!url || !selector) {
  console.error("usage: inspect.ts <url> <selector> [--limit N] [--depth N] [--html]");
  process.exit(1);
}
const flagValue = (name: string, fallback: number) => {
  const at = rest.indexOf(name);
  return at >= 0 ? Number(rest[at + 1]) : fallback;
};
const limit = flagValue("--limit", DEFAULT_MATCH_LIMIT);
const depth = flagValue("--depth", DEFAULT_TREE_DEPTH);
const asHtml = rest.includes("--html");

const { context, page } = await openPageWithExtension(url);
await page.waitForTimeout(SETTLE_MS);

const dump = await page.evaluate(
  ({ selector, limit, depth, asHtml, htmlLimit }) => {
    const describe = (el: Element, level: number): string[] => {
      const parts = [el.tagName.toLowerCase()];
      if (el.id) parts.push(`#${el.id}`);
      for (const attr of ["role", "data-testid", "href", "src"]) {
        const value = el.getAttribute(attr);
        if (value) parts.push(`[${attr}="${value.slice(0, 80)}"]`);
      }
      const classes = (el.getAttribute("class") ?? "").trim();
      if (classes) parts.push(`.${classes.split(/\s+/).slice(0, 3).join(".")}`);
      const ownText = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent?.trim())
        .filter(Boolean)
        .join(" ");
      if (ownText) parts.push(`"${ownText.slice(0, 60)}"`);
      const line = "  ".repeat(level) + parts.join(" ");
      if (level >= depth) return [el.children.length ? `${line} …` : line];
      return [line, ...[...el.children].flatMap((child) => describe(child, level + 1))];
    };
    const matches = [...document.querySelectorAll(selector)].slice(0, limit);
    return {
      total: document.querySelectorAll(selector).length,
      blocks: matches.map((el) =>
        asHtml ? el.outerHTML.slice(0, htmlLimit) : describe(el, 0).join("\n"),
      ),
    };
  },
  { selector, limit, depth, asHtml, htmlLimit: HTML_CHAR_LIMIT },
);

console.log(`${dump.total} match(es) for ${selector} — showing ${dump.blocks.length}\n`);
for (const [i, block] of dump.blocks.entries()) console.log(`--- match ${i + 1} ---\n${block}\n`);
await context.close();
