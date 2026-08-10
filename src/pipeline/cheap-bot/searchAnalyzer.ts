/**
 * cheap-bot stage 2b: search analyzer
 *
 * This step sits between the raw SearXNG fetch and the writer. The model reads
 * the post context and the messy search results, thinks about what is going on,
 * and produces a clean research brief with the source URLs inline. The writer
 * then works from this brief instead of the raw search snippets.
 *
 * The output is free text rather than JSON, so the model can reason before it
 * concludes.
 */

import { getBotConfig, llmTuningParams } from "../ab-testing/botConfig";
import { trackedLlmCreate, trackLlmCall } from "../cost-tracking/costTracker";
import { getTweetLog } from "../utils/tweetLog";
import { STEP, COST, ANALYSIS_LOG_MAX_CHARS } from "../utils/noteWriterSteps";
import { getMonitoringContext, buildReferenceBlock } from "../misinfo-monitoring/monitoringContext";
import { SEARCH_ANALYZER_SYSTEM_PROMPT, buildSearchAnalyzerUserMessage } from "../prompts/cheap-bot/searchAnalyzer";

export async function runSearchAnalyzer(
  postContext: string,
  rawFindings: string,
): Promise<string> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = config.search_analyzer_model ?? config.search_model ?? config.model;

  // On a misinfo-monitoring run we prepend the topic's ground-truth article. The
  // analyzer then grounds its brief in that article and surfaces its Source URL
  // as a citation.
  const monitoring = getMonitoringContext();
  const referenceBlock = monitoring ? `${buildReferenceBlock(monitoring)}\n\n` : "";
  const userMessage = buildSearchAnalyzerUserMessage({ referenceBlock, postContext, rawFindings });

  // This logs a short yes or no next to the analysis, so you can check at a
  // glance whether the reference was injected. The full injected text shows up
  // under search_analyzer.messages.0.
  log?.set(`${STEP.searchAnalyzer}.referenceInjected`, monitoring
    ? { topicId: monitoring.topicId, documentUrl: monitoring.documentUrl }
    : false);

  // We log the full input next to the output. This matches the messages.0 and
  // messages.1 convention that the other note_writer_steps follow.
  log?.set(`${STEP.searchAnalyzer}.messages.0`, { systemPrompt: SEARCH_ANALYZER_SYSTEM_PROMPT, userMessage, model });

  const { response, costEntry } = await trackedLlmCreate(COST.searchAnalyzer, {
    model,
    messages: [
      { role: "system" as const, content: SEARCH_ANALYZER_SYSTEM_PROMPT },
      { role: "user" as const, content: userMessage },
    ],
    ...llmTuningParams(config),
  } as any);
  trackLlmCall(costEntry);

  const content = response.choices?.[0]?.message?.content ?? "";
  log?.set(`${STEP.searchAnalyzer}.messages.1`, { content: content.slice(0, ANALYSIS_LOG_MAX_CHARS) });
  return content;
}
