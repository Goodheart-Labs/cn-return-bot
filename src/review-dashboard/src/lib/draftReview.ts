import { topicSetFor } from "../../../dashboard-shared/topicSets";
import type { FilterState, ReviewItem } from "./types";

export function draftReviewMetadata(logs: any): Partial<ReviewItem> {
  const report = logs?.reviewDraftBatch;
  if (!report || !["chat", "topic"].includes(report.input?.origin)) return {};
  const score = report.screening?.score;
  const topic = typeof report.input.topicId === "string" ? report.input.topicId : undefined;
  return {
    isDraft: !!report.result?.draft,
    topic,
    topicSet: topicSetFor(topic),
    tweetMedia: Array.isArray(report.input.post?.media) ? report.input.post.media : undefined,
    referencedTweetData: report.input.post?.referenced_tweet_data,
    draftReview: {
      origin: report.input.origin,
      postedAt: typeof report.input.post?.created_at === "string" && Number.isFinite(Date.parse(report.input.post.created_at))
        ? report.input.post.created_at : undefined,
      screeningScore: typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1 ? score : undefined,
      screeningReason: typeof report.screening?.reason === "string" ? report.screening.reason : undefined,
      screeningError: typeof report.screening?.error === "string" ? report.screening.error : undefined,
      reply: typeof report.result?.reply === "string" ? report.result.reply : undefined,
      warnings: Array.isArray(report.warnings) ? report.warnings.filter((w: unknown) => typeof w === "string") : [],
    },
  };
}

export function matchesDatasetFilters(filters: FilterState) {
  return (item: ReviewItem) => {
    if (filters.highValueOnly && !item.annotation?.highValue) return false;
    if (filters.topicSets.size && (!item.topicSet || !filters.topicSets.has(item.topicSet))) return false;
    if (filters.failureModes.size > 0) {
      return (item.annotation?.failureModes ?? []).some((m) => filters.failureModes.has(m));
    }
    if (filters.failureTypes.size > 0 && !filters.failureTypes.has(item.failureType)) return false;
    if (filters.seen === "seen" && !item.annotation?.seen) return false;
    if (filters.seen === "unseen" && item.annotation?.seen) return false;
    return true;
  };
}
