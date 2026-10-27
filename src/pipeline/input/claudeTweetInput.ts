/**
 * The input a Claude Code note writer reads for one tweet (GOO-527).
 *
 * It is the pipeline's own user message with the replies left out. Videos keep
 * their descriptions and audio transcripts, because Claude cannot watch a
 * video. For the tweet Claude is checking, images are not described. Claude
 * gets their links instead and looks at them itself. The examples in Claude's
 * system prompt keep the image descriptions, because they are rendered once,
 * ahead of time, and nobody looks at their images then.
 *
 * It runs outside any bot config, so the media are described by Gemini, the
 * model the media analysis falls back to.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import { DEFAULT_CONFIG } from "../ab-testing/botConfig";
import { analyzeMediaGemini } from "../media/mediaAnalysisGemini";
import { buildUserMessage } from "../prompts/input/userMessage";
import { getAuthorNoteHistory } from "./authorHistory";

export interface ClaudeTweetInputOptions {
  describeImages: boolean;
  authorHistory: boolean;
  /** The moment the input describes. See buildUserMessage. */
  now?: Date;
}

const isPhoto = (media: { type?: string }) => media.type === "photo";

function imageLinks(post: Post): string[] {
  const media = [...(post.media ?? []), ...(post.referenced_tweet_data?.media ?? [])];
  return media.filter(isPhoto).map((m) => m.url).filter((url): url is string => !!url);
}

export async function buildClaudeTweetInput(post: Post, options: ClaudeTweetInputOptions): Promise<string> {
  const keep = (media: { type?: string }[] | undefined) => (options.describeImages ? media : media?.filter((m) => !isPhoto(m)));
  const mediaResult = await analyzeMediaGemini(
    keep(post.media),
    keep(post.referenced_tweet_data?.media),
    DEFAULT_CONFIG.video_description_strategy,
    post.entities,
  );
  const message = buildUserMessage({
    post,
    tweetMedia: mediaResult.tweetMedia,
    quotedTweetMedia: mediaResult.quotedTweetMedia,
    authorNoteHistory: options.authorHistory ? await getAuthorNoteHistory(post.author_id) : undefined,
    now: options.now,
  });
  const links = options.describeImages ? [] : imageLinks(post);
  return links.length ? `${message}\n\n## Images on the post\n\n${links.join("\n")}` : message;
}
