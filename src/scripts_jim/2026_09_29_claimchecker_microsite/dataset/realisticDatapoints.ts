/**
 * The "Note/No-Note realistic" datapoints for the claim checker eval: claims
 * drawn uniformly at random from the claims production fact-checked after the
 * claim rater went live (sampleRealistic.ts), each judged by its own Opus
 * subagent on 2026-10-19. A subagent said whether the claim is misleading in
 * any way. Misleading means a note is expected.
 */
import sample from "./realisticSample.json";
import verdicts from "./realisticVerdicts.json";
import type { CheckedDatapoint } from "./datapoints";

export const REALISTIC_DATAPOINTS: CheckedDatapoint[] = verdicts.map((verdict, index) => {
  const claim = sample.claims.find((c) => c.id === verdict.claimId);
  if (!claim) throw new Error(`Claim ${verdict.claimId} is not in realisticSample.json`);
  return {
    id: `realistic-${String(index + 1).padStart(2, "0")}`,
    group: "realistic",
    checkerOnly: true,
    itemId: (claim.everything_items as { id: string }).id,
    claimSource: { from: "production", claimId: claim.id },
    jimsWords: `Not from the ticket. One of ${sample.claims.length} claims drawn uniformly at random from the ${sample.poolSize} claims that production fact-checked after the claim rater went live (9 September 2026), image claims left out. An Opus subagent judged it on 19 October 2026: ${verdict.misleading ? "misleading" : "not misleading"}. ${verdict.comment}`,
    writtenOn: "2026-10-19",
    expected: { decision: verdict.misleading ? "note" : "no_note" },
    referenceClaims: [],
  };
});
