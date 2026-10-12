/* Turns an article's HTML into reader text, the format a minisite stores its
 * article in (src/everything-core/readerText.ts describes it). It keeps
 * headings, paragraphs, links, emphasis, inline code, lists, quotes, figures
 * with captions, tables, code blocks and footnotes. An embedded tweet, video or
 * post becomes one [[EMBED:<url>]] line. Page chrome such as subscribe boxes
 * and share buttons is dropped, and so is anything else the format cannot say.
 *
 * Every character the reader text parser would read as markup is escaped, so
 * the words on screen are exactly the words on the page. */

import { parseHTML } from "linkedom";

/** Elements that are never article content. */
const CHROME_SELECTOR = [
  "script", "style", "noscript", "template", "form", "nav", "button", "input", "select", "textarea", "svg", "canvas", "dialog",
  ".subscription-widget-wrap", ".subscription-widget-wrap-editor", ".subscribe-widget", ".button-wrapper", ".captioned-button-wrap",
  ".post-ufi", ".share-dialog", ".header-anchor-parent", ".image-link-expand", ".footnote-hovercard",
].join(", ");

/** Class names of share, subscribe and comment widgets on pages other than
 *  Substack. Only whole class names or their dash-separated prefixes count, so
 *  "shared-image" stays. */
const CHROME_CLASS = /^(share|sharing|subscribe|subscription|comments|like-button|related-posts)(-|$)/;

/** Class names of the containers that hold an embedded tweet, video, post or
 *  podcast. Substack wraps each embed in one of these; the rest are the
 *  platforms' own embed codes. */
const EMBED_CLASS = /^(tweet|twitter-tweet|youtube-wrap|vimeo-wrap|spotify-wrap|soundcloud-wrap|apple-podcast-container|embedded-post-wrap|embedded-post|embedded-publication-wrap|instagram-media|bluesky-wrap|bluesky-embed|tiktok-embed|tiktok-wrap|reddit-embed-bq)$/;

const EMBED_TAGS = new Set(["iframe", "embed", "object", "video", "audio"]);
const EMBED_TAG_SELECTOR = [...EMBED_TAGS].join(", ");

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "details", "dd", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "li", "main", "ol", "p", "pre", "section", "summary", "table", "ul",
]);

const BLOCK_SELECTOR = [...BLOCK_TAGS, ...EMBED_TAGS].join(", ");

/** Heading levels of reader text. h1 and h2 both become level 2, because the
 *  minisite shows the article's own title above the text. */
const HEADING_MARKS: Record<string, string> = { h1: "##", h2: "##", h3: "###", h4: "####", h5: "####", h6: "####" };

const FOOTNOTE_CONTAINER_SELECTOR = ".footnotes, [role='doc-endnotes']";
const FOOTNOTE_BACKLINK_SELECTOR = "a.footnote-number, a.footnote-backref, a.reversefootnote, [role='doc-backlink'], a[href^='#fnref']";

const YOUTUBE_EMBED = /youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/;
const TWITTER_EMBED_ID = /platform\.twitter\.com\/embed\/Tweet\.html\?.*\bid=(\d+)/;

interface Conversion {
  pageUrl: string;
  blocks: string[];
  footnotes: string[];
  /** Footnote labels by the id of the footnote they point at. */
  footnoteLabels: Map<string, string>;
}

interface InlineContext {
  conversion: Conversion;
  /** Figures and embeds found inside a paragraph. They are written as their
   *  own blocks right after it. */
  hoisted: string[];
  inLink?: boolean;
  inEm?: boolean;
  inStrong?: boolean;
  inHeading?: boolean;
}

/** Converts article HTML to reader text blocks, in order, with the footnote
 *  definitions last. Relative links resolve against `pageUrl`. Joining the
 *  blocks with blank lines gives the reader text. */
export function htmlToReaderBlocks(html: string, pageUrl: string): string[] {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const body = document.body as unknown as Element;
  removeChrome(body);
  const conversion: Conversion = { pageUrl, blocks: [], footnotes: [], footnoteLabels: collectFootnoteLabels(body) };
  convertChildren(body, conversion);
  return [...conversion.blocks, ...conversion.footnotes];
}

function removeChrome(root: Element): void {
  for (const element of Array.from(root.querySelectorAll(CHROME_SELECTOR))) element.remove();
  for (const element of Array.from(root.querySelectorAll("[class]"))) {
    if (Array.from(element.classList).some((name) => CHROME_CLASS.test(name))) element.remove();
  }
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function isBlockLevel(element: Element): boolean {
  return BLOCK_TAGS.has(element.localName) || isEmbed(element) || !!element.querySelector(BLOCK_SELECTOR);
}

/** Converts the children of a container. Runs of inline content between block
 *  elements become paragraphs. */
function convertChildren(parent: Element, conversion: Conversion): void {
  let inline: Node[] = [];
  const flush = () => {
    if (inline.length) emitParagraph(inline, conversion);
    inline = [];
  };
  for (const child of Array.from(parent.childNodes)) {
    if (isElement(child) && isBlockLevel(child)) {
      flush();
      convertBlock(child, conversion);
    } else {
      inline.push(child);
    }
  }
  flush();
}

function convertBlock(element: Element, conversion: Conversion): void {
  if (isEmbed(element)) return emitEmbed(element, conversion);
  if (isFootnoteContainer(element)) return convertFootnotes(element, conversion);
  const tag = element.localName;
  if (HEADING_MARKS[tag]) return convertHeading(element, HEADING_MARKS[tag], conversion);
  switch (tag) {
    case "p":
      return emitParagraph(Array.from(element.childNodes), conversion);
    case "ul":
    case "ol":
      return convertList(element, conversion);
    case "blockquote":
      return convertQuote(element, conversion);
    case "pre":
      return convertCode(element, conversion);
    case "figure":
      return convertFigure(element, conversion);
    case "table":
      return convertTable(element, conversion);
    case "hr":
      return;
    default:
      return convertChildren(element, conversion);
  }
}

/** Escapes what the parser would read as a block marker at the start of a
 *  line: a heading, a quote, a list item or a table row. */
function escapeLineStart(line: string): string {
  return line.replace(/^([#>+|-])/, "\\$1").replace(/^(\d{1,9})([.)])/, "$1\\$2");
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function emitParagraph(nodes: Node[], conversion: Conversion): void {
  const context: InlineContext = { conversion, hoisted: [] };
  const text = collapseWhitespace(inlineMarkup(nodes, context));
  if (text) conversion.blocks.push(escapeLineStart(text));
  conversion.blocks.push(...context.hoisted);
}

function convertHeading(element: Element, mark: string, conversion: Conversion): void {
  const context: InlineContext = { conversion, hoisted: [], inHeading: true };
  const text = collapseWhitespace(inlineMarkup(Array.from(element.childNodes), context));
  if (text) conversion.blocks.push(`${mark} ${text}`);
  conversion.blocks.push(...context.hoisted);
}

function listItems(list: Element): Element[] {
  return Array.from(list.children).filter((child) => child.localName === "li");
}

/** Reader text has no nested lists. A nested list's items follow their parent
 *  item as bullets. Under a numbered list they form a short bullet list of
 *  their own, after which the numbered list resumes at the right number. */
function listLines(list: Element, nested: boolean, context: InlineContext): string[] {
  const ordered = list.localName === "ol" && !nested;
  const start = Number.parseInt(list.getAttribute("start") ?? "", 10) || 1;
  return listItems(list).flatMap((item, index) => {
    const ownNodes = Array.from(item.childNodes).filter((node) => !(isElement(node) && (node.localName === "ul" || node.localName === "ol")));
    const text = collapseWhitespace(inlineMarkup(ownNodes, context));
    const marker = ordered ? `${start + index}.` : "-";
    const sublists = Array.from(item.children).filter((child) => child.localName === "ul" || child.localName === "ol");
    return [...(text ? [`${marker} ${text}`] : []), ...sublists.flatMap((sublist) => listLines(sublist, true, context))];
  });
}

function convertList(list: Element, conversion: Conversion): void {
  const context: InlineContext = { conversion, hoisted: [] };
  const lines = listLines(list, false, context);
  if (lines.length) conversion.blocks.push(lines.join("\n"));
  conversion.blocks.push(...context.hoisted);
}

/** A figure or an embed line inside a quote cannot be shown there, so it
 *  follows the quote. */
const isMediaBlock = (block: string) => block.startsWith("![") || block.startsWith("[[EMBED:");

function convertQuote(quote: Element, conversion: Conversion): void {
  const inner: Conversion = { ...conversion, blocks: [] };
  convertChildren(quote, inner);
  const text = inner.blocks.filter((block) => !isMediaBlock(block));
  if (text.length) conversion.blocks.push(text.join("\n\n").split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n"));
  conversion.blocks.push(...inner.blocks.filter(isMediaBlock));
}

function convertCode(pre: Element, conversion: Conversion): void {
  const code = (pre.textContent ?? "").replace(/^\n+|\s+$/g, "");
  if (code) conversion.blocks.push(`\`\`\`\n${code}\n\`\`\``);
}

function convertFigure(figure: Element, conversion: Conversion): void {
  const images = Array.from(figure.querySelectorAll("img"));
  if (figure.querySelector(EMBED_TAG_SELECTOR) || !images.length || figure.querySelector("table, blockquote")) return convertChildren(figure, conversion);
  const caption = figure.querySelector("figcaption");
  const captionMarkup = caption ? collapseWhitespace(inlineMarkup(Array.from(caption.childNodes), { conversion, hoisted: [] })) : "";
  images.forEach((image, index) => {
    const markup = figureMarkup(image, index === images.length - 1 ? captionMarkup : "", conversion.pageUrl);
    if (markup) conversion.blocks.push(markup);
  });
}

function convertTable(table: Element, conversion: Conversion): void {
  const context: InlineContext = { conversion, hoisted: [] };
  const rows = Array.from(table.querySelectorAll("tr"))
    .map((row) => Array.from(row.children).filter((cell) => cell.localName === "td" || cell.localName === "th"))
    .filter((cells) => cells.length);
  if (!rows.length) return;
  const width = Math.max(...rows.map((cells) => cells.length));
  const line = (cells: Element[]) => {
    const texts = cells.map((cell) => collapseWhitespace(inlineMarkup(Array.from(cell.childNodes), context)).replace(/\|/g, "\\|"));
    while (texts.length < width) texts.push("");
    return `| ${texts.join(" | ")} |`;
  };
  const [header, ...body] = rows;
  conversion.blocks.push([line(header!), `| ${Array(width).fill("---").join(" | ")} |`, ...body.map(line)].join("\n"));
  conversion.blocks.push(...context.hoisted);
}

// ---------------------------------------------------------------------------
// Figures and embeds
// ---------------------------------------------------------------------------

/** An absolute http or https address, or null. Parentheses are encoded,
 *  because the parser reads a link's address up to its closing parenthesis. */
function absoluteUrl(raw: string | null | undefined, base: string): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim(), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href.replace(/\(/g, "%28").replace(/\)/g, "%29");
  } catch {
    return null;
  }
}

function imageSource(image: Element, pageUrl: string): string | null {
  const firstSrcset = (image.getAttribute("srcset") ?? "").split(",")[0]?.trim().split(/\s+/)[0];
  for (const candidate of [image.getAttribute("src"), image.getAttribute("data-src"), firstSrcset]) {
    const url = absoluteUrl(candidate, pageUrl);
    if (url) return url;
  }
  return null;
}

/** The parser reads a caption up to the next double quote, so double quotes
 *  inside it become curly ones. */
function curlyQuotes(text: string): string {
  let open = true;
  return text.replace(/"/g, () => ((open = !open) ? "\u201d" : "\u201c"));
}

function figureMarkup(image: Element, caption: string, pageUrl: string): string | null {
  const src = imageSource(image, pageUrl);
  if (!src) return null;
  const alt = collapseWhitespace(image.getAttribute("alt") ?? "").replace(/[[\]]/g, "");
  return caption ? `![${alt}](${src} "${curlyQuotes(caption)}")` : `![${alt}](${src})`;
}

function isEmbed(element: Element): boolean {
  return EMBED_TAGS.has(element.localName) || Array.from(element.classList).some((name) => EMBED_CLASS.test(name));
}

/** Substack describes each embed in a JSON data-attrs attribute. */
function substackEmbedUrl(element: Element): string | null {
  const raw = element.getAttribute("data-attrs") ?? element.querySelector("[data-attrs]")?.getAttribute("data-attrs");
  if (!raw) return null;
  try {
    const attrs = JSON.parse(raw) as { url?: unknown; videoId?: unknown };
    if (typeof attrs.url === "string") return attrs.url;
    if (typeof attrs.videoId === "string") return `https://www.youtube.com/watch?v=${attrs.videoId}`;
  } catch {
    // An attribute that is not JSON describes nothing we can link to.
  }
  return null;
}

/** A player address becomes the address of the thing it plays, which is what
 *  a reader can open. */
function playerTarget(src: string): string {
  const youtube = YOUTUBE_EMBED.exec(src);
  if (youtube) return `https://www.youtube.com/watch?v=${youtube[1]}`;
  const tweet = TWITTER_EMBED_ID.exec(src);
  if (tweet) return `https://x.com/i/status/${tweet[1]}`;
  return src;
}

function embedUrl(element: Element, pageUrl: string): string | null {
  const player = EMBED_TAGS.has(element.localName) ? element : element.querySelector(EMBED_TAG_SELECTOR);
  const playerSrc = player && (player.getAttribute("src") ?? player.getAttribute("data-src") ?? player.getAttribute("data") ?? player.querySelector("source")?.getAttribute("src"));
  const links = Array.from(element.querySelectorAll("a[href]")).map((link) => link.getAttribute("href"));
  const candidates = [
    substackEmbedUrl(element),
    element.getAttribute("data-instgrm-permalink"),
    element.getAttribute("cite"),
    playerSrc && playerTarget(playerSrc),
    // A tweet or post quoted by its platform's embed code ends with a link to
    // the post itself, after the links inside its text.
    links.at(-1),
  ];
  for (const candidate of candidates) {
    const url = absoluteUrl(candidate, pageUrl);
    if (url) return url.replace(/\s/g, "%20");
  }
  return null;
}

function emitEmbed(element: Element, conversion: Conversion): void {
  const url = embedUrl(element, conversion.pageUrl);
  if (url) conversion.blocks.push(`[[EMBED:${url}]]`);
}

// ---------------------------------------------------------------------------
// Footnotes
// ---------------------------------------------------------------------------

function isFootnoteReference(link: Element): boolean {
  const href = link.getAttribute("href") ?? "";
  if (link.classList.contains("footnote-anchor") || link.classList.contains("footnote-ref") || link.getAttribute("role") === "doc-noteref") return true;
  return /^#(fn|footnote)/i.test(href) && !/^#(fnref|footnote-anchor)/i.test(href) && link.parentElement?.localName === "sup";
}

/** A footnote's label is the number the page shows, such as "1". The parser
 *  takes any label without spaces or brackets. */
function referenceLabel(link: Element): string {
  const shown = (link.textContent ?? "").replace(/[[\]\s]/g, "");
  if (shown) return shown;
  return (link.getAttribute("href") ?? "").replace(/^#/, "").replace(/[[\]\s]/g, "") || "note";
}

function collectFootnoteLabels(root: Element): Map<string, string> {
  const labels = new Map<string, string>();
  for (const link of Array.from(root.querySelectorAll("a[href^='#']"))) {
    if (isFootnoteReference(link)) labels.set(link.getAttribute("href")!.slice(1), referenceLabel(link));
  }
  return labels;
}

function isFootnoteContainer(element: Element): boolean {
  return (element.classList.contains("footnote") && !!element.querySelector("a.footnote-number, .footnote-content")) || element.matches(FOOTNOTE_CONTAINER_SELECTOR);
}

/** Substack writes one div.footnote per footnote. Readability unwraps its
 *  div.footnote-content when that holds a single paragraph, and then the
 *  footnote's text is the div itself without its number. Other sites write a
 *  list of footnotes inside one container. */
function footnoteDefinitions(container: Element, labels: Map<string, string>): { label: string; body: Element }[] {
  if (container.classList.contains("footnote")) {
    const number = container.querySelector("a.footnote-number");
    const label = (number?.id && labels.get(number.id)) || (number ? referenceLabel(number) : "note");
    return [{ label, body: container.querySelector(".footnote-content") ?? container }];
  }
  return Array.from(container.querySelectorAll("li")).map((item, index) => ({ label: labels.get(item.id) ?? String(index + 1), body: item }));
}

function convertFootnotes(container: Element, conversion: Conversion): void {
  for (const { label, body } of footnoteDefinitions(container, conversion.footnoteLabels)) {
    for (const backlink of Array.from(body.querySelectorAll(FOOTNOTE_BACKLINK_SELECTOR))) backlink.remove();
    const text = collapseWhitespace(inlineMarkup(Array.from(body.childNodes), { conversion, hoisted: [] }));
    if (text) conversion.footnotes.push(`[^${label}]: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Inline markup
// ---------------------------------------------------------------------------

function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]]/g, "\\$&");
}

/** Puts delimiters around the inner markup, outside its leading and trailing
 *  spaces, because the parser only opens emphasis before a non-space and
 *  closes it after one. */
function wrap(inner: string, open: string, close: string): string {
  const [, before, core, after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return core ? `${before}${open}${core}${close}${after}` : inner;
}

function inlineMarkup(nodes: Node[], context: InlineContext): string {
  return nodes.map((node) => nodeMarkup(node, context)).join("");
}

function nodeMarkup(node: Node, context: InlineContext): string {
  if (node.nodeType === 3) return escapeInline((node.textContent ?? "").replace(/\s+/g, " "));
  if (!isElement(node)) return "";
  if (isEmbed(node)) {
    const url = embedUrl(node, context.conversion.pageUrl);
    if (url) context.hoisted.push(`[[EMBED:${url}]]`);
    return "";
  }
  const children = Array.from(node.childNodes);
  switch (node.localName) {
    case "br":
      return " ";
    case "img": {
      const figure = figureMarkup(node, "", context.conversion.pageUrl);
      if (figure) context.hoisted.push(figure);
      return "";
    }
    case "a":
      return linkMarkup(node, context);
    case "em":
    case "i":
      return emphasisMarkup(children, context);
    case "strong":
    case "b":
      return strongMarkup(children, context);
    case "code":
    case "kbd":
    case "samp":
      return codeMarkup(node);
    default: {
      const inner = inlineMarkup(children, context);
      return BLOCK_TAGS.has(node.localName) ? ` ${inner} ` : inner;
    }
  }
}

function linkMarkup(link: Element, context: InlineContext): string {
  if (isFootnoteReference(link)) {
    const target = link.getAttribute("href")!.slice(1);
    return `[^${context.conversion.footnoteLabels.get(target) ?? referenceLabel(link)}]`;
  }
  const inner = inlineMarkup(Array.from(link.childNodes), { ...context, inLink: true });
  const href = link.getAttribute("href") ?? "";
  const target = context.inLink || href.startsWith("#") ? null : absoluteUrl(href, context.conversion.pageUrl);
  return target ? wrap(inner, "[", `](${target})`) : inner;
}

/** An asterisk that is markup, not an escaped character. */
const MARKUP_ASTERISK = /(^|[^\\])\*/;

/** Emphasis inside bold text, or around bold text, is written with
 *  underscores. Asterisks there would run into the bold's own asterisks, and
 *  the parser could not tell them apart. */
function emphasisMarkup(children: Node[], context: InlineContext): string {
  if (context.inEm) return inlineMarkup(children, context);
  const inner = inlineMarkup(children, { ...context, inEm: true });
  const delimiter = context.inStrong || MARKUP_ASTERISK.test(inner) ? "_" : "*";
  return wrap(inner, delimiter, delimiter);
}

/** A heading is bold already, so bold inside it is dropped. */
function strongMarkup(children: Node[], context: InlineContext): string {
  if (context.inStrong || context.inHeading) return inlineMarkup(children, context);
  return wrap(inlineMarkup(children, { ...context, inStrong: true }), "**", "**");
}

/** Code containing a backtick cannot be written as inline code, so it stays
 *  plain text. */
function codeMarkup(element: Element): string {
  const code = (element.textContent ?? "").replace(/\s+/g, " ");
  if (!code.trim() || code.includes("`")) return escapeInline(code);
  return wrap(code, "`", "`");
}
