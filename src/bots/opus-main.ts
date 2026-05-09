/**
 * Opus Main Bot
 *
 * Primary bot using the original note writer prompt (raw character counting).
 * Uses Perplexity Sonar for search, Opus 4.5 for writing, Sonnet 4 for checking.
 */

import { Bot, PipelineResult } from "./types";
import { versionOneFn as perplexitySearch } from "../pipeline/search/searchContextGoal";
import { writeNoteWithSearchFn as writeNote } from "../pipeline/write/writeNoteLegacy";
import { verifySource } from "../pipeline/verify/sourceVerification";

const MODELS = {
  search: "perplexity/sonar",
  noteWriting: "anthropic/claude-opus-4.5",
  checking: "anthropic/claude-sonnet-4",
};

export const opusMain: Bot = {
  id: "opus-main",
  name: "Opus 4.5 (Main)",
  description: "Primary bot using Opus 4.5 with original note writer prompt",
  async runPipeline(post, content): Promise<PipelineResult | null> {
    const searchResult = await perplexitySearch(
      {
        text: content.text,
        media: content.media,
        mediaContext: "",
        quotedPostContext: content.quotedPostContext,
      },
      { model: MODELS.search }
    );

    const noteResult = await writeNote(
      {
        text: searchResult.text,
        searchResults: searchResult.searchResults,
        citations: searchResult.citations || [],
      },
      { model: MODELS.noteWriting }
    );

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
      searchContextResult: searchResult,
      noteResult,
      checkResult,
    };
  },
};
