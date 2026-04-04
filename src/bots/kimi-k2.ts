/**
 * Kimi K2.5 Bot
 *
 * Experimental bot using Moonshot's Kimi K2.5 for note writing and checking.
 * Uses Perplexity for search (same as opus-main).
 */

import { Bot, PipelineResult } from "./types";
import { versionOneFn as perplexitySearch } from "../pipeline/search/searchContextGoal";
import { writeNoteFn as writeNote } from "../pipeline/write/writeNote";
import { verifySource } from "../pipeline/verify/sourceVerification";

const MODELS = {
  search: "perplexity/sonar",
  noteWriting: "moonshotai/kimi-k2.5",
  checking: "moonshotai/kimi-k2.5",
};

export const kimiK2: Bot = {
  id: "kimi-k2",
  name: "Kimi K2.5",
  description: "Experimental bot using Moonshot Kimi K2.5 for note writing",
  weight: 0,

  async runPipeline(post, content): Promise<PipelineResult | null> {
    let lastStage = "started";
    try {
      // 1. Search with Perplexity
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

      // 2. Write note with Kimi K2.5
      lastStage = "note_writing";
      const noteResult = await writeNote(
        {
          text: searchResult.text,
          searchResults: searchResult.searchResults,
          citations: searchResult.citations || [],
        },
        { model: MODELS.noteWriting }
      );

      // 3. Check the note with Kimi K2.5
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
