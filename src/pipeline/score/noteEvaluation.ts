/**
 * Note Evaluation
 *
 * Evaluates proposed community notes in parallel and picks the highest-scoring one.
 */

import { evaluateNote } from "./noteEvaluationFilter";

export interface EvaluatedNote {
  noteText: string;
  sources: string[];
  allUrls: string;
  evalScore?: number;
}

export interface EvalResult extends EvaluatedNote {
  error?: string;
}

export async function evaluateAndPickBest(
  postId: string,
  notes: Array<{ note_text: string; sources: string[] }>,
): Promise<{ selected: EvaluatedNote; evalResults: EvalResult[] }> {
  const evalResults = await Promise.all(
    notes.map(async (n) => {
      const sources = (n.sources ?? []).filter(Boolean);
      const allUrls = sources.join(" ");
      const fullText = n.note_text + " " + allUrls;
      try {
        const response = await evaluateNote(postId, fullText);
        return { noteText: n.note_text, sources, allUrls, evalScore: response.data?.claim_opinion_score };
      } catch (err: any) {
        return { noteText: n.note_text, sources, allUrls, evalScore: undefined, error: err?.message };
      }
    }),
  );

  const scored = evalResults.filter((r) => r.evalScore != null);
  const selected = scored.length > 0
    ? scored.reduce((a, b) => (b.evalScore! > a.evalScore! ? b : a))
    : evalResults[0]!;

  return { selected, evalResults };
}
