/**
 * Opus Multi-Source Bot
 *
 * Same pipeline as opus-main-v2 but uses writeNoteMultiSource which
 * encourages citing 2-3 URLs inline. Source count correlates with
 * helpfulness (r=0.335 from calibration).
 */

import { Bot, PipelineResult } from "./types";
import { versionOneFn as perplexitySearch } from "../pipeline/search/searchContextGoal";
import { writeNoteMultiSourceFn as writeNote } from "../pipeline/write/writeNoteMultiSource";
import { verifySource } from "../pipeline/verify/sourceVerification";
import { analyzeMedia } from "../pipeline/media/mediaAnalysis";

const MODELS = {
  search: "perplexity/sonar",
  noteWriting: "anthropic/claude-opus-4.5",
  checking: "anthropic/claude-sonnet-4",
  vision: "anthropic/claude-sonnet-4",
};

export const opusMultiSource: Bot = {
  id: "opus-multi-source",
  name: "Opus 4.5 Multi-Source",
  description: "Encourages 2-3 inline source URLs for stronger evidence",
  async runPipeline(post, content): Promise<PipelineResult | null> {
    let lastStage = "started";
    const warnings: string[] = [];
    try {
      let mediaContext = "";
      if (content.mediaItems?.length) {
        try {
          const mediaResult = await analyzeMedia(content.mediaItems, {
            visionModel: MODELS.vision,
          });
          mediaContext = mediaResult.contextForSearch;
          lastStage = "media_analysis";
          if (mediaResult.warnings.length > 0) {
            warnings.push(...mediaResult.warnings);
          }
        } catch (err: any) {
          const msg = `Media analysis failed: ${err.message}`;
          const strippedText = content.text.replace(/@\w+/g, "").replace(/https?:\/\/\S+/g, "").trim();
          if (strippedText.length < 20) {
            throw new Error(`${msg} (fatal: media-only tweet has no text to search with)`);
          }
          warnings.push(msg);
        }
      }

      lastStage = "search";
      const searchResult = await perplexitySearch(
        {
          text: content.text,
          media: content.media,
          mediaContext,
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
          mediaContext,
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
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (err: any) {
      console.error(`[${this.id}] Pipeline error at ${lastStage}:`, err);
      throw err;
    }
  },
};
