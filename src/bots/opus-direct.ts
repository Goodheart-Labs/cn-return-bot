/**
 * Opus Direct Bot
 *
 * Bot designed from analysis of 302 "lost cases" where competing notes won.
 * Uses a direct, punchy writing style that leads with facts rather than
 * explaining what the post got wrong. Uses Opus 4.6 with Sonar Pro for
 * better search results.
 */

import { Bot, PipelineResult } from "./types";
import { versionOneFn as perplexitySearch } from "../pipeline/searchContextGoal";
import { writeNoteDirectFn as writeNote } from "../pipeline/writeNoteDirect";
import { verifySource } from "../pipeline/sourceVerification";

const MODELS = {
  search: "perplexity/sonar-pro",
  noteWriting: "anthropic/claude-opus-4.6",
  checking: "anthropic/claude-opus-4.6",
};

export const opusDirect: Bot = {
  id: "opus-direct",
  name: "Opus 4.6 Direct",
  description: "Direct style bot: leads with facts, punchy corrections, primary sources",
  weight: 7,

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
