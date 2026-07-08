/**
 * Prefilter — search analyzer.
 *
 * Sits between the raw SearXNG fetch and the note-needed judge. DeepSeek reads
 * the post context + messy search results, thinks about what's going on, and
 * produces a clean free-text research brief with source URLs inline. The judge
 * then decides from this brief instead of raw search snippets.
 *
 * Output is free text (not JSON) so the model can reason before concluding.
 */

import { getBotConfig, llmTuningParams } from "../ab-testing/botConfig";
import { trackedLlmCreate, trackLlmCall } from "../cost-tracking/costTracker";
import { getTweetLog } from "../utils/tweetLog";
import { STEP, COST, ANALYSIS_LOG_MAX_CHARS } from "../utils/noteWriterSteps";
import { getMonitoringContext, buildReferenceBlock } from "../misinfo-monitoring/monitoringContext";
import { SEARCH_ANALYZER_SYSTEM_PROMPT, buildSearchAnalyzerUserMessage } from "../prompts/prefilter/searchAnalyzer";

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
  const userMessage = buildSearchAnalyzerUserMessage({ referenceBlock, postContext, rawFindings });

  // Quick yes/no next to the analysis so injection is verifiable at a glance;
  // the full injected text shows under search_analyzer.messages.0.
  log?.set(`${STEP.searchAnalyzer}.referenceInjected`, monitoring
    ? { topicId: monitoring.topicId, documentUrl: monitoring.documentUrl }
    : false);

  // Log the full input alongside the output, matching the messages.0 /
  // messages.1 convention of the other note_writer_steps.
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
