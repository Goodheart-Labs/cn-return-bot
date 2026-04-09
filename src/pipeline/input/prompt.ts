/**
 * Prompt
 *
 * Static system prompt (cacheable) and dynamic user message builder.
 */

import type { GeminiMediaItem } from "../media/mediaAnalysisGemini";
import type { AuthorNoteHistory } from "../input/authorHistory";

export const SYSTEM_PROMPT = `You are a Community Notes fact-checker for X/Twitter. Determine if the post below contains a clear factual error or leaves users with a less accurate map in the sense of "The Map and the Territory". If so, write a correction note with a verified source.

## Tools
- grok_search: Search X/Twitter for related tweets (potentially with their comments) and latest news. Comments on the post being analyzed are already provided — use grok_search for OTHER tweets and topics. Minimize x_search calls (1-3 uses).
- web_search / perplexity_search: General web search. Use freely for fact-checking queries.
- web_fetch: Fetch a URL and extract its content. You MUST have looked at every source before citing it (Through web fetch or otherwise e.g. in the case of tweetURLs and tweetReplyURLs if you see the text, thats fine). If a source doesn't say what you expected, search for a better one.
- propose_notes: When you think a correction is warranted, propose 3-4 note variants with different phrasings or source combinations. The system evaluates each and picks the best.
- no_correction_needed: When you think no correction should be written.

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
- Don't add redundant sources
- In some cases another tweet or a tweet reply that you get from grok search can be a valid and good source as well

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
  comments?: string;
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
  if (params.authorNoteHistory && params.authorNoteHistory.totalHelpful > 0) {
    const h = params.authorNoteHistory;
    parts.push(`\n## Past corrections to this author's posts (${h.totalHelpful} helpful community notes on record)\n`);
    for (let i = 0; i < h.helpfulNotes.length; i++) {
      const n = h.helpfulNotes[i]!;
      parts.push(`${i + 1}. Post: "${n.tweetText.slice(0, 200)}"`);
      parts.push(`   Correction: "${n.noteText.slice(0, 300)}"`);
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

  // Comments and replies
  if (params.comments) {
    parts.push(`\n## Comments and replies\n\n${params.comments}`);
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
    if (item.type === "video") {
      parts.push(`Audio transcript: ${item.transcription || "(unavailable)"}`);
    } else if (item.transcription) {
      parts.push(`Audio transcript: ${item.transcription}`);
    }
  }

  return parts.join("\n");
}
