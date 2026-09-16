import { describe, expect, test } from "bun:test";
import { draftReviewMetadata, matchesDatasetFilters } from "../review-dashboard/src/lib/draftReview";
import type { FilterState, ReviewItem } from "../review-dashboard/src/lib/types";
import { defaultFilters, resultToFailureType } from "../review-dashboard/src/lib/types";

const item: ReviewItem = {
  id: "one", source: "dataset_run", tweetId: "123", failureType: "uncategorized",
  topicSet: "ai", annotation: { seen: false, failureModes: ["source issue"], highValue: true },
};
const filters = (overrides: Partial<FilterState> = {}): FilterState => ({
  seen: "all", failureTypes: new Set(), failureModes: new Set(), topicSets: new Set(), highValueOnly: false,
  ...overrides,
});

describe("draft batch review", () => {
  test("new review batches are visible by default without enabling uncategorized production notes", () => {
    const failureType = resultToFailureType("draft_review");
    expect(matchesDatasetFilters(defaultFilters("dataset_run"))({ ...item, failureType })).toBe(true);
    expect(defaultFilters("production").failureTypes.has(failureType)).toBe(false);
    expect(defaultFilters("production").failureTypes.has("uncategorized")).toBe(false);
  });
  test("starred-only and topic filters narrow uploaded batches, including when failure tags are selected", () => {
    const predicate = matchesDatasetFilters(filters({
      highValueOnly: true, topicSets: new Set(["ai"]), failureModes: new Set(["source issue"]),
    }));
    expect(predicate(item)).toBe(true);
    expect(predicate({ ...item, annotation: { ...item.annotation!, highValue: false } })).toBe(false);
    expect(predicate({ ...item, topicSet: "politics" })).toBe(false);
    expect(predicate({ ...item, topicSet: undefined })).toBe(false);
  });

  test("keeps seen and category filtering for ordinary uploaded datasets", () => {
    expect(matchesDatasetFilters(filters({ seen: "seen" }))(item)).toBe(false);
    expect(matchesDatasetFilters(filters({ seen: "unseen" }))(item)).toBe(true);
    expect(matchesDatasetFilters(filters({ failureTypes: new Set(["nw_success"]) }))(item)).toBe(false);
  });

  test("reads draft provenance and an uncalibrated screening score without changing X evaluation", () => {
    const metadata = draftReviewMetadata({ reviewDraftBatch: {
      input: { origin: "topic", topicId: "ai_water", post: { media: [{ type: "photo", url: "https://example.org/image" }] } },
      result: { draft: { text: "A correction." }, reply: "Source check passed." },
      screening: { score: 0, reason: "The correction misses the main claim." }, warnings: ["Missing media.", 4],
    } });
    expect(metadata.isDraft).toBe(true);
    expect(metadata.topicSet).toBe("ai");
    expect(metadata.draftReview?.screeningScore).toBe(0);
    expect(metadata.draftReview?.warnings).toEqual(["Missing media."]);
    expect(metadata.evaluationScore).toBeUndefined();
  });

  test("old datasets stay unchanged and invalid screening scores are not displayed", () => {
    expect(draftReviewMetadata({ oldLogs: true })).toEqual({});
    for (const score of [1.1, -1, NaN, "0.8"]) {
      expect(draftReviewMetadata({ reviewDraftBatch: {
        input: { origin: "chat", post: {} }, screening: { score },
      } }).draftReview?.screeningScore).toBeUndefined();
    }
  });
});
