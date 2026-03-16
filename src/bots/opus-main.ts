/**
 * Opus Main Bot
 *
 * Primary bot using the original note writer prompt (raw character counting).
 * Uses Perplexity Sonar for search, Opus 4.5 for writing, Sonnet 4 for checking.
 */

import { Bot, PipelineResult } from "./types";
import { versionOneFn as perplexitySearch } from "../pipeline/searchContextGoal";
import { writeNoteWithSearchFn as writeNote } from "../pipeline/legacy/writeNoteLegacy";
import { verifySource } from "../pipeline/sourceVerification";

const MODELS = {
  search: "perplexity/sonar",
  noteWriting: "anthropic/claude-opus-4.5",
  checking: "anthropic/claude-sonnet-4",
};

export const opusMain: Bot = {
  id: "opus-main",
  name: "Opus 4.5 (Main)",
  description: "Primary bot using Opus 4.5 with original note writer prompt",
  weight: 40,

  async runPipeline(post, content): Promise<PipelineResult | null> {
    let lastStage = "started";
    try {
      lastStage = "search";
      const searchResult = await perplexitySearch(
        {
          text: content.text,
          media: content.media,
          mediaContext: "",
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
