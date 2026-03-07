/**
 * Gemini 3 Flash Bot (LEGACY - disabled)
 *
 * Uses Google's Gemini 3 Flash Preview for note writing.
 * Newer than Gemini 2 Flash, potentially better quality.
 */

import { Bot, PipelineResult, PostContent } from "../types";
import { versionOneFn as perplexitySearch } from "../../pipeline/searchContextGoal";
import { writeNoteFn as writeNote } from "../../pipeline/writeNote";
import { verifySource } from "../../pipeline/sourceVerification";

// Bot model configuration - easy to tweak per-bot
const MODELS = {
  search: "perplexity/sonar",
  noteWriting: "google/gemini-3-flash-preview",
  checking: "anthropic/claude-sonnet-4", // use sonnet for checking
};

export const gemini3Flash: Bot = {
  id: "gemini-3-flash",
  name: "Gemini 3 Flash",
  description: "Google's Gemini 3 Flash Preview for note writing",
  weight: 0, // LEGACY - disabled

  async runPipeline(post, content): Promise<PipelineResult | null> {
    let lastStage = "started";
    try {
      // 1. Search with Perplexity
      const searchResult = await perplexitySearch(
        {
          text: content.text,
          media: content.media,
          searchResults: "",
          quotedPostContext: content.quotedPostContext,
        },
        { model: MODELS.search }
      );
      lastStage = "search";

      // 2. Write note
      const noteResult = await writeNote(
        {
          text: searchResult.text,
          searchResults: searchResult.searchResults,
          citations: searchResult.citations || [],
        },
        { model: MODELS.noteWriting }
      );
      lastStage = "note_writing";

      // 3. Check the note
      const checkResult = await verifySource(
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
