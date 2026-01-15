/**
 * Gemini 3 Flash Bot
 *
 * Uses Google's Gemini 3 Flash Preview for note writing.
 * Newer than Gemini 2 Flash, potentially better quality.
 */

import { Bot, PipelineResult, PostContent } from "./types";
import { versionOneFn as perplexitySearch } from "../pipeline/searchContextGoal";
import { writeNoteWithSearchFn as writeNote } from "../pipeline/writeNoteWithSearchGoal";
import { check as checkNote } from "../pipeline/check";

const NOTE_MODEL = "google/gemini-3-flash-preview";

export const gemini3Flash: Bot = {
  id: "gemini-3-flash",
  name: "Gemini 3 Flash",
  description: "Google's Gemini 3 Flash Preview for note writing",
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

      // 2. Write note with Gemini 3 Flash
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
