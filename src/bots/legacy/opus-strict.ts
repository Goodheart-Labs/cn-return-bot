/**
 * Opus Strict Bot
 *
 * Uses Claude Opus 4.5 with stricter quality filters than opus-scored.
 * Higher scoring thresholds (0.7 instead of 0.5) and minimum note length.
 *
 * Designed based on analysis showing:
 * - Helpful notes average 308 chars (vs 217 for not helpful)
 * - Not helpful notes often use negative framing or pedantic corrections
 * - opus-main has best delta (helpful - not helpful) at 19.4%
 */

import { Bot, PipelineResult, PostContent } from "../types";
import { versionOneFn as perplexitySearch } from "../../pipeline/searchContextGoal";
import { writeNoteFn as writeNote } from "../../pipeline/writeNote";
import { verifySource } from "../../pipeline/sourceVerification";
import {
  runNoteScores,
  AllNoteScores,
} from "../../pipeline/noteScores";

// Bot model configuration
const MODELS = {
  search: "perplexity/sonar",
  noteWriting: "anthropic/claude-opus-4.5",
  checking: "anthropic/claude-opus-4.5", // Use Opus for checking too
  scoring: "anthropic/claude-sonnet-4",
};

// Stricter thresholds based on analysis
const THRESHOLDS = {
  positiveEvidence: 0.7, // Higher than default 0.5
  disagreement: 0.7,
  helpfulness: 0.7,
  minNoteLength: 200, // Helpful notes avg 308 chars
};

export const opusStrict: Bot = {
  id: "opus-strict",
  name: "Opus (Strict)",
  description:
    "Opus 4.5 with stricter quality filters: higher thresholds (0.7) and min note length",
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

      // 3. Check the note with Opus (stricter checking)
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
        // Check minimum length first
        if (noteResult.note.length < THRESHOLDS.minNoteLength) {
          console.log(
            `[${this.id}] Note too short: ${noteResult.note.length} chars < ${THRESHOLDS.minNoteLength} required`
          );
          noteResult.status = "NOTE_TOO_SHORT";
        } else {
          console.log(`[${this.id}] Running scoring filters with strict thresholds...`);
          scoringResults = await runNoteScores(
            noteResult.note,
            content.text,
            searchResult.searchResults,
            noteResult.url,
            MODELS.scoring
          );
          lastStage = "scoring";

          // Use stricter thresholds
          allScoresPassed =
            scoringResults.positiveEvidence.score > THRESHOLDS.positiveEvidence &&
            scoringResults.disagreement.score > THRESHOLDS.disagreement &&
            scoringResults.helpfulness.score > THRESHOLDS.helpfulness;

          console.log(`[${this.id}] Strict thresholds (>${THRESHOLDS.positiveEvidence}): ${allScoresPassed ? "PASS" : "FAIL"}`);

          // Log detailed scores
          console.log(
            `[${this.id}] Scores - Positive: ${scoringResults.positiveEvidence.score.toFixed(2)} (need >${THRESHOLDS.positiveEvidence}), ` +
              `Disagreement: ${scoringResults.disagreement.score.toFixed(2)} (need >${THRESHOLDS.disagreement}), ` +
              `Helpfulness: ${scoringResults.helpfulness.score.toFixed(2)} (need >${THRESHOLDS.helpfulness})`
          );

          if (!allScoresPassed) {
            console.log(`[${this.id}] Strict scoring filters failed - note will not be posted`);
            noteResult.status = "STRICT_SCORING_FAILED";
          }
        }
      }

      const result: PipelineResult = {
        post,
        botId: this.id,
        lastStage,
        searchContextResult: searchResult,
        noteResult,
        checkResult,
      };

      // Add scoring data
      (result as any).scoringResults = scoringResults;
      (result as any).allScoresPassed = allScoresPassed;
      (result as any).thresholds = THRESHOLDS;

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
