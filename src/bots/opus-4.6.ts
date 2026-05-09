/**
 * Opus 4.6 Bot
 *
 * Same pipeline as opus-main but using Claude Opus 4.6 for all non-search stages.
 */

import { Bot, PipelineResult } from "./types";
import { versionOneFn as perplexitySearch } from "../pipeline/search/searchContextGoal";
import { writeNoteFn as writeNote } from "../pipeline/write/writeNote";
import { verifySource } from "../pipeline/verify/sourceVerification";

const MODELS = {
  search: "perplexity/sonar",
  noteWriting: "anthropic/claude-opus-4.6",
  checking: "anthropic/claude-opus-4.6",
};

export const opus46: Bot = {
  id: "opus-4.6",
  name: "Opus 4.6",
  description: "Claude Opus 4.6 for note writing and checking",
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
      throw err;
    }
  },
};
