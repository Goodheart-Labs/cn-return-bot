/**
 * DeepSeek Bot
 *
 * Uses DeepSeek V3 for note writing - very cheap (~$0.30/$1.20 per M tokens)
 * but strong reasoning capabilities.
 */

import { Bot, PipelineResult, PostContent } from "./types";
import { versionOneFn as perplexitySearch } from "../pipeline/searchContextGoal";
import { writeNoteWithSearchFn as writeNote } from "../pipeline/writeNoteWithSearchGoal";
import { check as checkNote } from "../pipeline/check";

const NOTE_MODEL = "deepseek/deepseek-chat";

export const deepseek: Bot = {
  id: "deepseek",
  name: "DeepSeek V3",
  description: "Cheap but capable - DeepSeek V3 for note writing",
  weight: 10,

  async runPipeline(post, content): Promise<PipelineResult | null> {
    let lastStage = "started";
    try {
      // 1. Search with Perplexity
      const searchResult = await perplexitySearch(
        {
          text: content.text,
          media: content.media,
          searchResults: "",
          retweetContext: content.retweetContext,
        },
        { model: "perplexity/sonar" }
      );
      lastStage = "search";

      // 2. Write note with DeepSeek V3
      const noteResult = await writeNote(
        {
          text: searchResult.text,
          searchResults: searchResult.searchResults,
          citations: searchResult.citations || [],
        },
        { model: NOTE_MODEL }
      );
      lastStage = "note_writing";

      // 3. Check the note
      const checkResult = await checkNote({
        note: noteResult.note,
        url: noteResult.url,
        status: noteResult.status,
      });
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
        searchContextResult: {
          text: content.text,
          searchResults: "",
          citations: [],
        },
        noteResult: { note: "", url: "", status: "ERROR" },
        checkResult: "",
        error: err?.message || String(err),
      };
    }
  },
};
