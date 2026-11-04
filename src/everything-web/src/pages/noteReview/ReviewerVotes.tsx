import type { Reviewer, ReviewDraft, ReviewVote } from "@cn/core/claudeReview";
import { cn } from "@cn/ui/cn";

export const PERSON: Record<Reviewer | "claude", string> = { jim: "Jim", nathan: "Nathan", claude: "Claude" };
const REVIEWERS: Reviewer[] = ["jim", "nathan"];
const VOTE_LABELS: Record<ReviewVote, string> = { 1: "Helpful", 0: "Somewhat helpful", [-1]: "Not helpful" };
const VOTE_TONES: Record<ReviewVote, string> = {
  1: "bg-positive-soft text-positive",
  0: "bg-caution-soft text-caution",
  [-1]: "bg-negative-soft text-negative",
};

/** Jim's and Nathan's votes on a note. */
export function ReviewerVotes({ votes }: { votes: ReviewDraft["reviewerVotes"] }) {
  if (votes.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {REVIEWERS.flatMap((reviewer) => {
        const vote = votes.find((v) => v.reviewer === reviewer)?.vote;
        return vote === undefined
          ? []
          : [
              <span key={reviewer} className="flex items-center gap-1.5">
                <span className="font-medium text-fg-secondary">{PERSON[reviewer]}</span>
                <span className={cn("rounded-full px-2 py-0.5 font-semibold", VOTE_TONES[vote])}>{VOTE_LABELS[vote]}</span>
              </span>,
            ];
      })}
    </p>
  );
}
