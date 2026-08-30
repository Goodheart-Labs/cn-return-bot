/**
 * Prompt for the SearXNG result summarizer.
 *
 * It turns raw SearXNG results into a brief that keeps as many URLs as it can.
 * The summarized variant of the google_search tool uses it. The caller is
 * handleGoogleSearchSummarized in src/pipeline/tool-calling/tools.ts.
 * `formattedResults` is whatever formatSearxngResults returned.
 */

export function buildSearxngSummarizePrompt(query: string, formattedResults: string): string {
  return `You are a research assistant. The user searched for: "${query}"

Here are the search results:
${formattedResults}

Summarize the most relevant findings. Include the URLs of the most important sources inline in your summary. Include a lot of URLs. Focus on factual claims and verifiable information.`;
}
