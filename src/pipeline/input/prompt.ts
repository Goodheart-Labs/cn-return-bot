/**
 * Prompt
 *
 * System prompt builder and dynamic user message builder.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { GeminiMediaItem } from "../media/mediaAnalysisGemini";
import type { AuthorNoteHistory } from "../input/authorHistory";
import type { BotConfig } from "../utils/botConfig";

function buildToolSection(config: BotConfig): string {
  const lines: string[] = [];
  lines.push("- grok_search: Search X/Twitter for related tweets (potentially with their comments) and latest news. Comments on the post being analyzed are already provided — use grok_search for OTHER tweets and topics. Minimize x_search calls (1-3 uses).");

  if (config.web_search === "perplexity") {
    lines.push("- perplexity_search: General web search. Use freely for fact-checking queries.");
  }

  lines.push("- web_fetch: Fetch a URL and extract its content. You MUST have looked at every source before citing it (through web_fetch or otherwise e.g. in the case of tweetURLs and tweetReplyURLs if you see the text, that's fine). If a source doesn't say what you expected, search for a better one.");

  lines.push("- propose_notes: When you think a correction is warranted, propose 3-4 note variants with different phrasings or source combinations. The system evaluates each and picks the best.");
  lines.push("- no_correction_needed: When you think no correction should be written.");
  return lines.join("\n");
}

export function buildSystemPrompt(config: BotConfig): string {
  return `You are a Community Notes fact-checker for X/Twitter. Determine if the post below contains a clear factual error or leaves users with a less accurate map in the sense of "The Map and the Territory". If so, write a correction note with a verified source.

## Tools
${buildToolSection(config)}

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
- For every source (except tweets and tweet replies) you MUST use the web_fetch tool to validate the source before proposing a note!

## When NOT to correct
- Opinions, satire, jokes, hyperbole
- Posts that are correct
- When you can't find strong, direct contradicting evidence
- When the "error" is too minor or pedantic`;
}

function getQuotedPostText(post: Post): string | undefined {
  const quotedRef = post.referenced_tweets?.find((rt) => rt.type === "quoted");
  return quotedRef && post.referenced_tweet_data
    ? post.referenced_tweet_data.text
    : undefined;
}

export function buildUserMessage(params: {
  post: Post;
  tweetText: string;
  tweetMedia: GeminiMediaItem[];
  quotedTweetMedia: GeminiMediaItem[];
  authorNoteHistory?: AuthorNoteHistory;
  comments?: string;
}): string {
  const { post } = params;
  const now = new Date();
  const parts: string[] = [];

  // Timestamps
  parts.push(`Current date: ${now.toISOString().split("T")[0]}`);
  parts.push(`Current time: ${now.toISOString().split("T")[1]!.slice(0, 5)} UTC`);
  parts.push(`Tweet posted: ${post.created_at}`);
  parts.push(`Tweet URL: https://x.com/i/status/${post.id}`);

  // Author info
  const authorParts: string[] = [];
  if (post.author_name) authorParts.push(post.author_name);
  if (post.author_followers != null) authorParts.push(`${post.author_followers.toLocaleString()} followers`);
  if (post.author_tweet_count != null) authorParts.push(`${post.author_tweet_count.toLocaleString()} posts`);
  if (authorParts.length) parts.push(`\nAuthor: ${authorParts.join(" — ")}`);
  if (post.author_description) parts.push(`Author bio: ${post.author_description}`);

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
  const quotedPostText = getQuotedPostText(post);
  if (quotedPostText) {
    parts.push(`\n## Quoted post\n\n${quotedPostText}`);
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
