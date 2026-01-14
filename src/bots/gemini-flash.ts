/**
 * Gemini Flash Bot
 *
 * Cost-effective bot using Gemini 2.0 Flash.
 * Fast and cheap - good for testing if expensive models are necessary.
 */

import { Bot, PipelineResult, PostContent } from "./types";
import { versionOneFn as perplexitySearch } from "../pipeline/searchContextGoal";
import { writeNoteWithSearchFn as writeNote } from "../pipeline/writeNoteWithSearchGoal";
import { check as checkNote } from "../pipeline/check";

const NOTE_MODEL = "google/gemini-2.0-flash-001";

export const geminiFlash: Bot = {
  id: "gemini-flash",
  name: "Gemini Flash (Cheap)",
  description: "Cost-effective bot using Gemini 2.0 Flash - fast and cheap",
  weight: 0, // Disabled - performing poorly

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

      // 2. Write note with Gemini Flash
      const noteResult = await writeNote(
        {
          text: searchResult.text,
          searchResults: searchResult.searchResults,
          citations: searchResult.citations || [],
        },
        { model: NOTE_MODEL, currentDate: new Date().toISOString().split("T")[0] }
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
