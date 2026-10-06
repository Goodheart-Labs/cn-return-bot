import type { ReactNode } from "react";

const BULLET = /^\s*[-*]\s+(.*)$/;
// One level of parentheses inside a URL, as in Wikipedia links.
const INLINE = /\*\*(.+?)\*\*|\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

function httpsUrl(url: string): boolean {
  try { return new URL(url).protocol === "https:"; } catch { return false; }
}

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const [whole, bold, label, url] = match;
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (bold !== undefined) nodes.push(<strong key={match.index}>{inline(bold)}</strong>);
    else if (httpsUrl(url!)) nodes.push(<a key={match.index} href={url} target="_blank" rel="noopener noreferrer">{inline(label!)}</a>);
    else nodes.push(whole);
    last = match.index + whole.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function renderAnswerMarkdown(text: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}>{inline(paragraph.join("\n"))}</p>);
    if (bullets.length) blocks.push(<ul key={blocks.length}>{bullets.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>);
    paragraph = [];
    bullets = [];
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const bullet = BULLET.exec(line);
    if (!line.trim()) flush();
    else if (bullet) {
      if (paragraph.length) flush();
      bullets.push(bullet[1]!);
    } else if (bullets.length && /^\s/.test(line)) bullets[bullets.length - 1] += ` ${line.trim()}`;
    else {
      if (bullets.length) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
