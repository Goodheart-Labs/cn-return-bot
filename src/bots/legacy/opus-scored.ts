/**
 * Opus Scored Bot
 *
 * Uses Claude Opus 4.5 with additional scoring filters from community-notes-writer.
 * Runs positive claims, disagreement, and helpfulness filters before deciding to post.
 */

import { Bot, PipelineResult, PostContent } from "../types";
import { versionOneFn as perplexitySearch } from "../../pipeline/searchContextGoal";
import { writeNoteFn as writeNote } from "../../pipeline/writeNote";
import { verifySource } from "../../pipeline/sourceVerification";
import {
  runNoteScores,
  checkAllThresholds,
  AllNoteScores,
} from "../../pipeline/noteScores";

// Bot model configuration - easy to tweak per-bot
const MODELS = {
  search: "perplexity/sonar",
  noteWriting: "anthropic/claude-opus-4.5",
  checking: "anthropic/claude-opus-4.5",
  scoring: "anthropic/claude-sonnet-4", // cheaper for validation
};

export const opusScored: Bot = {
  id: "opus-scored",
  name: "Opus (Scored)",
  description:
    "Opus 4.5 with scoring filters: positive claims, disagreement, helpfulness",
  weight: 0,

  async runPipeline(post, content): Promise<PipelineResult | null> {
    let lastStage = "started";
    let scoringResults: AllNoteScores | undefined;
    let allScoresPassed = false;

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

      // 4. Run scoring filters (only if note looks valid)
      if (
        noteResult.status === "CORRECTION WITH TRUSTWORTHY CITATION" &&
        noteResult.note &&
        noteResult.url
      ) {
        console.log(`[${this.id}] Running scoring filters...`);
        scoringResults = await runNoteScores(
          noteResult.note,
          content.text,
          searchResult.searchResults,
          noteResult.url,
          MODELS.scoring
        );
        lastStage = "scoring";

        allScoresPassed = checkAllThresholds(scoringResults);
        console.log(`[${this.id}] All scores passed: ${allScoresPassed}`);

        // Log detailed scores
        console.log(
          `[${this.id}] Scores - Positive: ${scoringResults.positiveEvidence.score.toFixed(2)}, ` +
            `Disagreement: ${scoringResults.disagreement.score.toFixed(2)}, ` +
            `Helpfulness: ${scoringResults.helpfulness.score.toFixed(2)}`
        );

        // If scores fail, mark the note as rejected so it won't be posted
        if (!allScoresPassed) {
          console.log(`[${this.id}] Scoring filters failed - note will not be posted`);
          noteResult.status = "SCORING_FILTERS_FAILED";
        }
      }

      // Build result with scoring data in a way that's compatible with existing type
      const result: PipelineResult = {
        post,
        botId: this.id,
        lastStage,
        searchContextResult: searchResult,
        noteResult,
        checkResult,
      };

      // Add scoring data as additional properties
      (result as any).scoringResults = scoringResults;
      (result as any).allScoresPassed = allScoresPassed;

      return result;
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
