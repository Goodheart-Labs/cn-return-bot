/**
 * Opus Main Bot (LEGACY - disabled)
 *
 * Original primary bot using the legacy note writer (raw character counting,
 * no URL-aware length, no CRITICAL LENGTH CONSTRAINT in prompt).
 * Kept for historical data tracking.
 */

import { Bot, PipelineResult } from "../types";
import { versionOneFn as perplexitySearch } from "../../pipeline/searchContextGoal";
import { writeNoteWithSearchFn as writeNote } from "../../pipeline/legacy/writeNoteLegacy";
import { check as checkNote } from "../../pipeline/check";

const MODELS = {
  search: "perplexity/sonar",
  noteWriting: "anthropic/claude-opus-4.5",
  checking: "anthropic/claude-sonnet-4",
};

export const opusMainLegacy: Bot = {
  id: "opus-main",
  name: "Opus 4.5 (Main Legacy)",
  description: "Original primary bot using legacy note writer (raw char counting)",
  weight: 0,

  async runPipeline(post, content): Promise<PipelineResult | null> {
    let lastStage = "started";
    try {
      const searchResult = await perplexitySearch(
        {
          text: content.text,
          media: content.media,
          searchResults: "",
          retweetContext: content.retweetContext,
        },
        { model: MODELS.search }
      );
      lastStage = "search";

      const noteResult = await writeNote(
        {
          text: searchResult.text,
          searchResults: searchResult.searchResults,
          citations: searchResult.citations || [],
        },
        { model: MODELS.noteWriting }
      );
      lastStage = "note_writing";

      const checkResult = await checkNote(
        {
          note: noteResult.note,
          url: noteResult.url,
          status: noteResult.status,
        },
        { model: MODELS.checking }
      );
      lastStage = "check";

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
