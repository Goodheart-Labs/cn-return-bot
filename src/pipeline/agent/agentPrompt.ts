/**
 * Agent Prompt
 *
 * Static system prompt (cacheable) and dynamic user message builder.
 */

import type { GeminiMediaItem } from "../media/mediaAnalysisGemini";
import type { AuthorNoteHistory } from "./agentAuthorHistory";

export const SYSTEM_PROMPT = `You are a Community Notes fact-checker for X/Twitter. Determine if the post below contains a clear factual error. If so, write a correction note with a verified source.

## Workflow

1. Understand the specific factual claim the post makes
2. Search for evidence (use grok_search for X context and latest news, web search for broader facts)
3. For each potential source: fetch it and verify it directly supports your correction
4. If evidence is strong: submit_note. If not: no_correction_needed.

## Note style

- Lead with what IS true, not "The post claims..." or "This is false"
  GOOD: "This video was recorded in January 2024 during a murder trial."
  BAD: "The post falsely claims that..."
- One key fact. Pick the single strongest piece of evidence.
- 1-2 sentences before the URL. Short and direct.
- No hedging: don't say "appears to", "seems to", "potentially"
- Neutral, bridging tone: write so people who agree AND disagree with the post both find your note fair and informative
- No sarcasm, no "gotcha" framing, no partisan language
- Prefer primary sources (official sites, X posts, Wikipedia, YouTube originals) over news articles

## Character limit

- Target: 240-260 non-URL characters
- Hard max: 275 non-URL characters (URLs are shortened by X and count as 1 character each)
- Be concise. Every word must earn its place.

## Source rules

- Every source must DIRECTLY support your specific correction (not just general background)
- Don't add redundant sources that say the same thing
- You MUST fetch each source URL and verify it before citing
- If a source doesn't say what you expected, search for a better one or reconsider your correction

## When NOT to correct

- Opinions, satire, jokes, hyperbole
- Posts that are correct
- When you can't find strong, direct contradicting evidence
- When the "error" is too minor or pedantic`;

export function buildUserMessage(params: {
  tweetText: string;
  tweetId: string;
  tweetDate: string;
  quotedPostText?: string;
  tweetMedia: GeminiMediaItem[];
  quotedTweetMedia: GeminiMediaItem[];
  authorName?: string;
  authorDescription?: string;
  authorFollowers?: number;
  authorTweetCount?: number;
  authorNoteHistory?: AuthorNoteHistory;
  currentDate: string;
  currentTime: string;
}): string {
  const parts: string[] = [];

  // Timestamps
  parts.push(`Current date: ${params.currentDate}`);
  parts.push(`Current time: ${params.currentTime} UTC`);
  parts.push(`Tweet posted: ${params.tweetDate}`);
  parts.push(`Tweet URL: https://x.com/i/status/${params.tweetId}`);

  // Author info
  const authorParts: string[] = [];
  if (params.authorName) authorParts.push(params.authorName);
  if (params.authorFollowers != null) authorParts.push(`${params.authorFollowers.toLocaleString()} followers`);
  if (params.authorTweetCount != null) authorParts.push(`${params.authorTweetCount.toLocaleString()} posts`);
  if (authorParts.length) parts.push(`\nAuthor: ${authorParts.join(" — ")}`);
  if (params.authorDescription) parts.push(`Author bio: ${params.authorDescription}`);

  // Author note history
  if (params.authorNoteHistory && (params.authorNoteHistory.totalHelpful > 0 || params.authorNoteHistory.totalNotHelpful > 0)) {
    const h = params.authorNoteHistory;
    parts.push(`\n## Past helpful community notes on this author's posts (from our records)\n`);
    parts.push(`${h.totalHelpful} helpful notes, ${h.totalNotHelpful} not helpful notes on record.`);
    for (let i = 0; i < h.helpfulNotes.length; i++) {
      const n = h.helpfulNotes[i]!;
      parts.push(`\n${i + 1}. Tweet: "${n.tweetText.slice(0, 200)}"`);
      parts.push(`   Note: "${n.noteText.slice(0, 300)}"`);
    }
  }

  // Post
  parts.push(`\n## Post\n\n${params.tweetText}`);

  // Quoted post
  if (params.quotedPostText) {
    parts.push(`\n## Quoted post\n\n${params.quotedPostText}`);
  }

  // Media on post
  if (params.tweetMedia.length) {
    parts.push(`\n## Media on post`);
    parts.push(formatMediaItems(params.tweetMedia));
  }

  // Media on quoted post
  if (params.quotedTweetMedia.length) {
    parts.push(`\n## Media on quoted post`);
    parts.push(formatMediaItems(params.quotedTweetMedia));
  }

  return parts.join("\n");
}

function formatMediaItems(items: GeminiMediaItem[]): string {
  const parts: string[] = [];
  let imageIdx = 0;
  let videoIdx = 0;

  for (const item of items) {
    if (item.type === "image") {
      imageIdx++;
      parts.push(`\n### Image ${imageIdx}`);
    } else {
      videoIdx++;
      parts.push(`\n### Video ${videoIdx}`);
    }

    if (item.description.description) {
      parts.push(`Description: ${item.description.description}`);
    }
    if (item.description.ocrText) {
      parts.push(`Visible text: ${item.description.ocrText}`);
    }
    if (item.transcription) {
      parts.push(`Audio transcript: ${item.transcription}`);
    }
  }

  return parts.join("\n");
}
