/**
 * The second research round.
 *
 * When the source verifier rejects a note, the research step gets one more turn
 * in its own conversation. The researcher already holds its first message and
 * its own answer. A follow-up message adds the note that was written from its
 * findings and everything the verifier said, and it writes revised findings.
 * Because the conversation continues, the provider reads the first message
 * from its prompt cache. In the evals this fixed most
 * of the notes that claimed more than their sources said. The same research
 * model does the revision as did the first research: the quick model stays the
 * quick model and the stronger model stays the stronger one.
 * SECOND_ROUND_TEST in abTestsData.ts switches it on.
 */

import { getBotConfig } from "../ab-testing/botConfig";
import { STEP } from "../utils/noteWriterSteps";
import type { SourceVerification } from "../verify/sourceVerifier";
import { CASCADE_NO_NOTE_BELOW, runQuickSearch, runStrongSearch } from "./cascadeSearch";
import { runSearch, type ResearchFollowUp } from "./search";

export interface SecondRoundInput {
  /** The message the first research was given, unchanged. */
  userMessage: string;
  /** The findings that the writer wrote the rejected note from. */
  findings: string;
  /** The researcher's first answer as JSON text. Without it, the answer is rebuilt from the findings. */
  answer?: string;
  researchedBy: "quick" | "full";
  noteText: string;
  verification: SourceVerification;
}

/** The follow-up message: the rejected note and the verifier's answer, with what to do about them. The researcher's first message and answer are already in its conversation. */
export function secondRoundMessage(input: Pick<SecondRoundInput, "noteText" | "verification">): string {
  const { verification } = input;
  const verifierAnswer = {
    accepted: verification.accepted,
    reasoning: verification.reasoning,
    sources: verification.source_evaluations ?? { good: verification.good_sources, bad: verification.bad_sources },
  };
  return `A community note was written from your findings. A source checker opened the pages the note cites and rejected the note.

## The note that was written from your findings
${input.noteText}

## The source checker's answer
${JSON.stringify(verifierAnswer, null, 1)}

Write revised research findings, in the same format as before. Keep what the checker confirmed. Remove or reword every claim that no fetched page supports. For a page that could not be fetched, find another page that says the same thing and can be opened, and cite that instead. Cite only pages whose text states what you rely on.`;
}

/** Revised findings, and whether the research now says no note is needed. */
export async function reviseResearch(input: SecondRoundInput): Promise<{ findings: string; withdrew: boolean }> {
  const followUp: ResearchFollowUp = { answer: input.answer ?? JSON.stringify({ findings: input.findings }), message: secondRoundMessage(input) };
  if (input.researchedBy === "quick") {
    const quick = await runQuickSearch(input.userMessage, `${STEP.root}.second_round_research`, followUp);
    return { findings: quick.findings, withdrew: quick.probability < CASCADE_NO_NOTE_BELOW };
  }
  const search = await (getBotConfig().search_cascade ? runStrongSearch(input.userMessage, followUp) : runSearch(input.userMessage, followUp));
  return { findings: search.findings, withdrew: !search.correctionNeeded };
}
