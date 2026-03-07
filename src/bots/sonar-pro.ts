/**
 * Sonar Pro Bot
 *
 * Same pipeline as opus-main but uses Perplexity's Sonar Pro for search,
 * which provides deeper, more thorough search results.
 */

import { Bot, PipelineResult } from "./types";
import { versionOneFn as perplexitySearch } from "../pipeline/searchContextGoal";
import { writeNoteFn as writeNote } from "../pipeline/writeNote";
import { verifySource } from "../pipeline/sourceVerification";

const MODELS = {
  search: "perplexity/sonar-pro",
  noteWriting: "anthropic/claude-opus-4.5",
  checking: "anthropic/claude-sonnet-4",
};

export const sonarPro: Bot = {
  id: "sonar-pro",
  name: "Opus 4.5 + Sonar Pro",
  description: "Opus 4.5 with Perplexity Sonar Pro for deeper search results",
  weight: 0,

  async runPipeline(post, content): Promise<PipelineResult | null> {
    let lastStage = "started";
    try {
      lastStage = "search";
      const searchResult = await perplexitySearch(
        {
          text: content.text,
          media: content.media,
          searchResults: "",
          quotedPostContext: content.quotedPostContext,
        },
        { model: MODELS.search }
      );

      lastStage = "note_writing";
      const noteResult = await writeNote(
        {
          text: searchResult.text,
          searchResults: searchResult.searchResults,
          citations: searchResult.citations || [],
        },
        { model: MODELS.noteWriting }
      );

      lastStage = "check";
      const checkResult = await verifySource(
        {
          note: noteResult.note,
          url: noteResult.url,
          status: noteResult.status,
        },
        { model: MODELS.checking }
      );

      return {
        post,
        botId: this.id,
        lastStage,
        searchContextResult: searchResult,
        noteResult,
        checkResult,
      };
    } catch (err: any) {
      console.error(`[${this.id}] Pipeline error at ${lastStage}:`, err);
      return {
        post,
        botId: this.id,
        lastStage,
        searchContextResult: { text: content.text, searchResults: "", citations: [] },
        noteResult: { note: "", url: "", status: "ERROR" },
        checkResult: "",
        error: err?.message || String(err),
      };
    }
  },
};
