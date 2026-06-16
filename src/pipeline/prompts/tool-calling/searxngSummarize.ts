/**
 * Prompt — SearXNG result summarizer.
 *
 * Summarizes raw SearXNG results into a URL-rich brief for the google_search
 * tool's summarized variant. See handleGoogleSearchSummarized in
 * src/pipeline/tool-calling/tools.ts. `formattedResults` is the output of
 * formatSearxngResults.
 */

export function buildSearxngSummarizePrompt(query: string, formattedResults: string): string {
  return `You are a research assistant. The user searched for: "${query}"

Here are the search results:
${formattedResults}

Summarize the most relevant findings. Include the URLs of the most important sources inline in your summary. Include a lot of URLs. Focus on factual claims and verifiable information.`;
}
