/**
 * BotConfig for the deepseek note-filter — every step on deepseek-v4-flash,
 * SearXNG web search, reasoning high + temperature 0 (matches cheap-bot's
 * deterministic settings so the eval doesn't flip run-to-run).
 */
import type { BotConfig } from "../../pipeline/ab-testing/botConfig";

export const DEEPSEEK = "deepseek/deepseek-v4-flash";

export const FILTER_CONFIG: BotConfig = {
  botId: "deepseek-note-filter",
  model: DEEPSEEK,
  search_model: DEEPSEEK,
  search_analyzer_model: DEEPSEEK,
  note_judge_model: DEEPSEEK,
  web_search: "searxng",
  video_description_strategy: "frames",
  parallel_research: false,
  search_analyzer: true,
  note_needed_judge: true,
  satire_detector: false,
  reasoning_effort: "high",
  temperature: 0,
  feed_size: "small",
};
