import { createGoal } from "@tonerow/agent-framework";
import { z } from "zod";
import posts from "../utils/posts.json";
import { extractCitations, llm } from "../llm/llm";
import type { OpenAIChatModelId } from "@ai-sdk/openai/internal";
import type { ChatCompletionContentPartImage } from "openai/resources";
import { textAndSearchResults } from "../llm/schemas";
import { getTweetLog, logLlmCall } from "../utils/tweetLog";

const sanitizedPosts = posts.map(({ text, media }) => {
  return {
    text,
    media: media
      .map((m) =>
        "url" in m
          ? m.url
          : "preview_image_url" in m
            ? m.preview_image_url
            : null
      )
      .filter((m): m is string => Boolean(m)),
  };
});

const searchContextGoal = createGoal({
  name: "search context",
  description: `Given a post and search results, identify the most important missing factual context that would help readers understand the full picture.`,
  input: z.object({
    text: z.string(),
    media: z.array(z.string()),
    mediaContext: z.string().optional(),
    quotedPostContext: z.string().optional(),
  }),
  output: textAndSearchResults,
});

sanitizedPosts.map((post, index) =>
  searchContextGoal.test(`Post ${index}`, {
    ...post,
  })
);

export const searchVersionOne = searchContextGoal.register<{
  model: OpenAIChatModelId;
}>({
  name: "version one",
  config: [
    {
      model: "perplexity/sonar",
    },
  ],
});

export async function versionOneFn(
  input: {
    text: string;
    media: string[];
    mediaContext?: string;
    quotedPostContext?: string;
  },
  config: {
    model: OpenAIChatModelId;
  }
) {
  // Only include image_url parts for models that support vision.
  // Perplexity sonar models reject image inputs with "Failed to load image".
  const isPerplexity = config.model.startsWith("perplexity/");
  const images: ChatCompletionContentPartImage[] = isPerplexity
    ? []
    : input.media.map((url) => ({
      type: "image_url",
      image_url: { url },
    }));

  let systemPrompt = `You are a context and factchecking tool. Search the web for information that DIRECTLY addresses or contradicts the specific claims made in the following post.

IMPORTANT: Only provide sources that:
1. Directly support or contradict the exact claims made in the post
2. Are recent enough to be relevant to the timeframe referenced
3. Address the specific people, events, or facts mentioned (not general background)

Always include specific URLs for your sources directly in the text.`;

  if (input.quotedPostContext) {
    systemPrompt += ` ${input.quotedPostContext}`;
  }

  let userText = input.text;
  if (input.mediaContext) {
    userText += `\n\n[Media context]\n${input.mediaContext}`;
  }

  const messages = [
    {
      role: "system" as const,
      content: systemPrompt,
    },
    {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: userText,
        },
        ...images,
      ],
    },
  ];

  const startMs = Date.now();
  const result = await llm.create({
    model: config.model,
    messages,
  });

  const citations = extractCitations(result);
  const searchResults = result.choices?.[0]?.message?.content ?? "Error";

  const log = getTweetLog();
  log?.set("search.citations", citations);
  log?.set("search.model", config.model);
  logLlmCall("search", messages, searchResults, Date.now() - startMs);

  return {
    text: input.text,
    searchResults,
    citations,
    quotedPostContext: input.quotedPostContext,
  };
}

searchVersionOne.define(versionOneFn);
