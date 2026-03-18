/**
 * Multi-Source Search Module
 *
 * Extracts topic from tweet, then searches multiple sources:
 * - Perplexity (existing)
 * - Serper (Google)
 * - Exa
 */

import { extractCitations, llm } from "./llm";
import { getTweetLog } from "./tweetLog";
import type { ChatCompletionContentPartImage } from "openai/resources";

export interface MultiSearchResult {
  text: string;
  searchResults: string;
  citations: string[];
  quotedPostContext?: string;
  searchSources: {
    perplexity: boolean;
    google: boolean;
    exa: boolean;
  };
}

interface SearchSourceResult {
  source: string;
  results: string;
  citations: string[];
  success: boolean;
  error?: string;
}

/**
 * Extract the main topic/claim from a tweet for targeted searching
 */
async function extractTopic(text: string): Promise<string> {
  const result = await llm.create({
    model: "anthropic/claude-sonnet-4",
    messages: [
      {
        role: "system",
        content: `Extract the main factual claim or topic from this tweet that needs fact-checking.
Return a concise search query (10-20 words) that would help find relevant sources.
Focus on: specific claims, names, dates, events, statistics.
Do NOT include opinions or subjective statements.
Return ONLY the search query, nothing else.`,
      },
      {
        role: "user",
        content: text,
      },
    ],
  });

  return result.choices?.[0]?.message?.content?.trim() || text.slice(0, 100);
}

/**
 * Search using Perplexity (existing method)
 */
async function searchPerplexity(
  text: string,
  media: string[],
  quotedPostContext?: string
): Promise<SearchSourceResult> {
  try {
    const images: ChatCompletionContentPartImage[] = media.map((url) => ({
      type: "image_url",
      image_url: { url },
    }));

    let systemPrompt = `You are a context and factchecking tool. Search the web for information that DIRECTLY addresses or contradicts the specific claims made in the following post.

IMPORTANT: Only provide sources that:
1. Directly support or contradict the exact claims made in the post
2. Are recent enough to be relevant to the timeframe referenced
3. Address the specific people, events, or facts mentioned (not general background)

Always include specific URLs for your sources directly in the text.`;

    if (quotedPostContext) {
      systemPrompt += ` ${quotedPostContext}`;
    }

    const result = await llm.create({
      model: "perplexity/sonar",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: text,
            },
            ...images,
          ],
        },
      ],
    });

    return {
      source: "perplexity",
      results: result.choices?.[0]?.message?.content ?? "",
      citations: extractCitations(result),
      success: true,
    };
  } catch (err: any) {
    return {
      source: "perplexity",
      results: "",
      citations: [],
      success: false,
      error: err.message,
    };
  }
}

/**
 * Search using Serper.dev (Google)
 */
async function searchGoogle(topic: string): Promise<SearchSourceResult> {
  const apiKey = process.env.SERPER_API_KEY;

  if (!apiKey) {
    return {
      source: "google",
      results: "",
      citations: [],
      success: false,
      error: "Serper API not configured (SERPER_API_KEY)",
    };
  }

  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: topic,
        num: 5,
      }),
    });

    if (!response.ok) {
      throw new Error(`Serper API error: ${response.status}`);
    }

    const data = (await response.json()) as any;
    const organic = data.organic || [];

    const results = organic
      .map(
        (r: any, i: number) =>
          `${i + 1}. ${r.title}\n   ${r.snippet}\n   URL: ${r.link}`
      )
      .join("\n\n");

    const citations = organic.map((r: any) => r.link);

    return {
      source: "google",
      results: results || "No results found",
      citations,
      success: true,
    };
  } catch (err: any) {
    return {
      source: "google",
      results: "",
      citations: [],
      success: false,
      error: err.message,
    };
  }
}

/**
 * Search using Exa
 */
async function searchExa(topic: string): Promise<SearchSourceResult> {
  const apiKey = process.env.EXA_API_KEY;

  if (!apiKey) {
    return {
      source: "exa",
      results: "",
      citations: [],
      success: false,
      error: "Exa API not configured",
    };
  }

  try {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: topic,
        numResults: 5,
        useAutoprompt: true,
        type: "neural",
      }),
    });

    if (!response.ok) {
      throw new Error(`Exa API error: ${response.status}`);
    }

    const data = (await response.json()) as any;
    const results = (data.results || [])
      .map(
        (r: any, i: number) =>
          `${i + 1}. ${r.title}\n   ${r.snippet || r.text?.slice(0, 200) || ""}\n   URL: ${r.url}`
      )
      .join("\n\n");

    const citations = (data.results || []).map((r: any) => r.url);

    return {
      source: "exa",
      results: results || "No results found",
      citations,
      success: true,
    };
  } catch (err: any) {
    return {
      source: "exa",
      results: "",
      citations: [],
      success: false,
      error: err.message,
    };
  }
}

/**
 * Perform multi-source search
 */
export async function multiSourceSearch(input: {
  text: string;
  media: string[];
  quotedPostContext?: string;
}): Promise<MultiSearchResult> {
  const topic = await extractTopic(input.text);

  // Run all searches in parallel
  const [perplexityResult, googleResult, exaResult] = await Promise.all([
    searchPerplexity(input.text, input.media, input.quotedPostContext),
    searchGoogle(topic),
    searchExa(topic),
  ]);

  // Write to tweet log
  const log = getTweetLog();
  log?.set("multiSearch.topic", topic);
  log?.set("multiSearch.perplexity", {
    success: perplexityResult.success,
    citationCount: perplexityResult.citations.length,
    error: perplexityResult.error,
  });
  log?.set("multiSearch.google", {
    success: googleResult.success,
    citationCount: googleResult.citations.length,
    error: googleResult.error,
  });
  log?.set("multiSearch.exa", {
    success: exaResult.success,
    citationCount: exaResult.citations.length,
    error: exaResult.error,
  });

  // Combine results
  const combinedResults: string[] = [];
  const allCitations: string[] = [];

  if (perplexityResult.success && perplexityResult.results) {
    combinedResults.push(
      `=== PERPLEXITY SEARCH ===\n${perplexityResult.results}`
    );
    allCitations.push(...perplexityResult.citations);
  }

  if (googleResult.success && googleResult.results) {
    combinedResults.push(`=== GOOGLE SEARCH ===\n${googleResult.results}`);
    allCitations.push(...googleResult.citations);
  }

  if (exaResult.success && exaResult.results) {
    combinedResults.push(`=== EXA SEARCH ===\n${exaResult.results}`);
    allCitations.push(...exaResult.citations);
  }

  // Deduplicate citations
  const uniqueCitations = [...new Set(allCitations)];

  return {
    text: input.text,
    searchResults: combinedResults.join("\n\n") || "No search results found",
    citations: uniqueCitations,
    quotedPostContext: input.quotedPostContext,
    searchSources: {
      perplexity: perplexityResult.success,
      google: googleResult.success,
      exa: exaResult.success,
    },
  };
}
