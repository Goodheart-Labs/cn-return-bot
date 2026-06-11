import type { ReactNode } from "react";

const URL_PATTERN = /https?:\/\/[^\s]+/g;
// Trailing characters that read as sentence punctuation, not part of the URL.
const TRAILING_PUNCTUATION = /[.,;:!?'")\]}]+$/;

function countChar(text: string, char: string) {
  let count = 0;
  for (const c of text) if (c === char) count++;
  return count;
}

// Strip sentence punctuation from the end of a matched URL, but keep a trailing
// ")" that closes a paren inside the URL (e.g. wikipedia.org/wiki/Foo_(bar)).
function splitTrailingPunctuation(matched: string): { url: string; trailing: string } {
  let trailing = matched.match(TRAILING_PUNCTUATION)?.[0] ?? "";
  let url = trailing ? matched.slice(0, -trailing.length) : matched;
  while (trailing.startsWith(")") && countChar(url, "(") > countChar(url, ")")) {
    url += ")";
    trailing = trailing.slice(1);
  }
  return { url, trailing };
}

// Render text with every http(s) URL turned into its own clickable link.
// Each URL becomes a separate anchor (no greedy merging of adjacent links).
export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    const matched = match[0];
    const { url, trailing } = splitTrailingPunctuation(matched);

    if (start > lastIndex) nodes.push(text.slice(lastIndex, start));
    nodes.push(
      <a
        key={start}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-500 hover:underline break-all"
      >
        {url}
      </a>,
    );
    if (trailing) nodes.push(trailing);
    lastIndex = start + matched.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));

  return <p className={className}>{nodes}</p>;
}
