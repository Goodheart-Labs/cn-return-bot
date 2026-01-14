/**
 * Opus Main Bot
 *
 * Primary bot using Claude Opus 4.5 with standard Perplexity search.
 * This is the "production quality" bot that handles most traffic.
 */

import { Bot, PipelineResult, PostContent } from "./types";
import { versionOneFn as perplexitySearch } from "../pipeline/searchContextGoal";
import { writeNoteWithSearchFn as writeNote } from "../pipeline/writeNoteWithSearchGoal";
import { check as checkNote } from "../pipeline/check";

const NOTE_MODEL = "anthropic/claude-opus-4.5";

export const opusMain: Bot = {
  id: "opus-main",
  name: "Opus 4.5 (Main)",
  description: "Primary bot using Claude Opus 4.5 for highest quality notes",
  weight: 80,

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

      // 2. Write note with Opus 4.5
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
        searchContextResult: { text: content.text, searchResults: "", citations: [] },
        noteResult: { note: "", url: "", status: "ERROR" },
        checkResult: "",
        error: err?.message || String(err),
      };
    }
  },
};
