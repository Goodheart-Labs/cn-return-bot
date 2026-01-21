/**
 * Multi-Search Bot (LEGACY - disabled)
 *
 * Uses multiple search sources for comprehensive context:
 * - Perplexity
 * - Google (via Serper)
 * - Exa
 * - X API
 *
 * Requires env vars: SERPER_API_KEY, EXA_API_KEY, X_SEARCH_BEARER_TOKEN
 */

import { Bot, PipelineResult, PostContent } from "../types";
import { multiSourceSearch } from "../../pipeline/multiSourceSearch";
import { writeNoteWithSearchFn as writeNote } from "../../pipeline/writeNoteWithSearchGoal";
import { check as checkNote } from "../../pipeline/check";

// Bot model configuration - easy to tweak per-bot
const MODELS = {
  noteWriting: "anthropic/claude-opus-4.5",
  checking: "anthropic/claude-sonnet-4", // cheaper for validation
};

export const multiSearch: Bot = {
  id: "multi-search",
  name: "Multi-Source Search",
  description:
    "Extracts topic first, then searches Perplexity + Google + Exa + X for comprehensive context",
  weight: 0, // LEGACY - disabled

  async runPipeline(post, content): Promise<PipelineResult | null> {
    let lastStage = "started";
    try {
      // 1. Multi-source search (Perplexity + Google + Exa + X)
      const searchResult = await multiSourceSearch({
        text: content.text,
        media: content.media,
        retweetContext: content.retweetContext,
      });
      lastStage = "search";

      // 2. Write note
      const noteResult = await writeNote(
        {
          text: searchResult.text,
          searchResults: searchResult.searchResults,
          citations: searchResult.citations || [],
        },
        { model: MODELS.noteWriting, currentDate: new Date().toISOString().split("T")[0] }
      );
      lastStage = "note_writing";

      // 3. Check the note
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
