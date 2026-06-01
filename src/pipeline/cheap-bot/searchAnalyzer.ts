/**
 * cheap-bot — Stage 2b: Search analyzer
 *
 * Sits between the raw SearXNG fetch and the writer. DeepSeek reads the post
 * context + messy search results, thinks about what's going on, and produces
 * a clean free-text research brief with source URLs inline. The writer then
 * works from this brief instead of raw search snippets.
 *
 * Output is free text (not JSON) so the model can reason before concluding.
 */

import { getBotConfig, llmTuningParams } from "../ab-testing/botConfig";
import { trackedLlmCreate, trackLlmCall } from "../cost-tracking/costTracker";
import { getTweetLog } from "../utils/tweetLog";
import { STEP } from "../utils/noteWriterSteps";
import { getMonitoringContext, buildReferenceBlock } from "../misinfo-monitoring/monitoringContext";

const SYSTEM_PROMPT = `You receive a social-media post and raw search results. Distill them into a research brief.

Think step by step: what does the post claim, what do the search results say, and if the post is wrong, what's actually true?

Write a brief (a few paragraphs) with specific names, dates, numbers, and all relevant source URLs inline (Its important that you include the full source URLs). Only use information from the search results.

If a reference document is provided, treat it as ground truth for the topic and include its Source URL inline as a citation.`;

export async function runSearchAnalyzer(
  postContext: string,
  rawFindings: string,
): Promise<string> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = config.search_analyzer_model ?? config.search_model ?? config.model;

  // Misinfo pre-pass: prepend the topic's ground-truth article so the analyzer
  // grounds its brief in it and surfaces the Source URL as a citation.
  const monitoring = getMonitoringContext();
  const referenceBlock = monitoring ? `${buildReferenceBlock(monitoring)}\n\n` : "";
  const userMessage = `${referenceBlock}${postContext}\n\n## Raw search results\n\n${rawFindings}`;

  // Quick yes/no next to the analysis so injection is verifiable at a glance;
  // the full injected text shows under llm_inputs.cheapBot.searchAnalyzer.
  log?.set(`${STEP.searchAnalyzer}.referenceInjected`, monitoring
    ? { topicId: monitoring.topicId, documentUrl: monitoring.documentUrl }
    : false);

  const { response, costEntry } = await trackedLlmCreate("cheapBot.searchAnalyzer", {
    model,
    messages: [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: userMessage },
    ],
    ...llmTuningParams(config),
  } as any);
  trackLlmCall(costEntry);

  const content = response.choices?.[0]?.message?.content ?? "";
  log?.set(`${STEP.searchAnalyzer}.analysis`, content.slice(0, 4000));
  return content;
}
