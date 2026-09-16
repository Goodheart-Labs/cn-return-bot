import { describe, expect, mock, test } from "bun:test";
import { draftReviewRows, runUploadDraftReview } from "./uploadDraftReview";
import type { ReviewItemInsert } from "../dashboard-shared/reviewUpload";

const uploadId = "12345678-1234-4321-8765-123456789abc";
const note = { text: "The record gives a different date.", sources: ["https://example.org/record", "https://example.org/archive"] };
function report(id = "2099621874279817638") {
  return {
    tweetId: id, status: "draft", createdAt: "2026-09-16T12:00:00Z",
    input: {
      origin: "topic", topicId: "ai_water", fetchedAt: "2026-09-16T11:00:00Z",
      post: { id, text: "Original claim.", author_id: "42", created_at: "2026-09-15T12:00:00Z", media: [] },
    },
    result: { reply: "Source check passed.", draft: note, research: "Original research." },
    noteText: "An outdated rendered value that must not override the actual draft.",
    screening: { label: "uncalibrated screening score", score: 0.9, reason: "A central factual correction.", scores: [] },
    warnings: ["Media unavailable."],
  };
}

function fixture(results: unknown[] = [report()]) {
  const createUpload = mock(async (_upload: { name: string; item_count: number }) => uploadId);
  const insertItems = mock(async (_rows: ReviewItemInsert[]) => {});
  const deleteUpload = mock(async (_id: string) => {});
  const log = mock((_text: string) => {});
  const readInput = mock(async (_path: string) => JSON.stringify({ schemaVersion: 1, results }));
  const client = { createUpload, insertItems, deleteUpload };
  return {
    createUpload, insertItems, deleteUpload, log, readInput,
    run: (extra: string[] = []) => runUploadDraftReview(["--input", "results.json", "--name", "Draft review", ...extra], { client, log, readInput }),
    output: () => log.mock.calls.map(([text]) => text).join("\n"),
  };
}

describe("draft review uploads", () => {
  test("maps full drafts and preserves provenance, research, and advisory scores only in logs", () => {
    const input = report();
    const row = draftReviewRows(uploadId, { results: [input] })[0]!;
    expect(row.url).toBe(`https://x.com/i/web/status/${input.tweetId}`);
    expect(row.tweet_text).toBe(input.input.post.text);
    expect(row.note_text).toBe(`${note.text} ${note.sources.join(" ")}`);
    expect(row.note_status).toBe("draft");
    expect(row.outcome).toBe("draft_for_review");
    expect(row.result).toBe("draft_review");
    expect(row.evaluation_score).toBeNull();
    expect(JSON.parse(JSON.stringify(row.logs))).toEqual({ reviewDraftBatch: input });
  });

  test("maps abstentions and errors without presenting either as a draft", () => {
    const first = { ...report(), status: "no_draft", result: { reply: "No correction.", research: "Evidence supports the post." } };
    const second = { ...report("123"), status: "error", result: undefined, error: "Research failed." };
    const rows = draftReviewRows(uploadId, { results: [first, second] });
    expect(rows.map((row) => [row.outcome, row.note_status, row.note_text])).toEqual([
      ["no_draft", null, null], ["error", null, null],
    ]);
    expect(rows[1]!.failure_reason).toBe("Research failed.");
    expect(rows.every((row) => row.result === "draft_review")).toBe(true);
  });

  test("uses the shared serializer to remove NULs from source text and nested logs", () => {
    const input = report();
    input.input.post.text = "Original\u0000 claim.";
    input.result.research = "Research\u0000 findings.";
    const row = draftReviewRows(uploadId, { results: [input] })[0]!;
    expect(row.tweet_text).toBe("Original claim.");
    expect(JSON.stringify(row.logs)).not.toContain("\\u0000");
  });

  test("validates the whole batch before creating any remote records", async () => {
    const invalid = { ...report("123"), input: { ...report("123").input, origin: "unknown" } };
    const f = fixture([report(), invalid]);
    expect(await f.run()).toBe(1);
    expect(f.createUpload).not.toHaveBeenCalled();
    expect(f.insertItems).not.toHaveBeenCalled();
    expect(() => draftReviewRows(uploadId, { results: [] })).toThrow("nonempty");
    expect(() => draftReviewRows(uploadId, { results: [{ ...report(), tweetId: "123" }] })).toThrow("matching");
    expect(() => draftReviewRows(uploadId, { results: [{ ...report(), status: "submitted" }] })).toThrow("valid status");
    expect(() => draftReviewRows(uploadId, { results: [{ ...report(), result: { draft: { text: "No sources", sources: [] }, reply: "Draft" } }] })).toThrow("invalid note");
  });

  test("help does not read the input or initialize an upload", async () => {
    const f = fixture();
    expect(await f.run(["--help"])).toBe(0);
    expect(f.output()).toContain("Usage:");
    expect(f.readInput).not.toHaveBeenCalled();
    expect(f.createUpload).not.toHaveBeenCalled();
  });

  test.each([
    "file:///tmp/dashboard", "https://user:private-api-token@example.org", "https://example.org/?token=private-api-token",
  ])("rejects unsafe dashboard URLs without exposing their contents: %s", async (url) => {
    const f = fixture();
    expect(await f.run(["--dashboard-url", url])).toBe(1);
    expect(f.createUpload).not.toHaveBeenCalled();
    expect(f.output()).not.toContain("private-api-token");
  });

  test("imports every result in bounded chunks and prints the review link", async () => {
    const f = fixture(Array.from({ length: 51 }, (_, index) => report(String(1000 + index))));
    expect(await f.run(["--dashboard-url", "https://review.example.org/dashboard"])).toBe(0);
    expect(f.createUpload).toHaveBeenCalledWith({ name: "Draft review", item_count: 51 });
    expect(f.insertItems.mock.calls.map(([rows]) => rows.length)).toEqual([50, 1]);
    expect(f.insertItems.mock.calls.flatMap(([rows]) => rows).every((row) => row.upload_id === uploadId)).toBe(true);
    expect(f.deleteUpload).not.toHaveBeenCalled();
    expect(f.output()).toContain(`https://review.example.org/dashboard?upload=${uploadId}`);
  });

  test("rolls back only the new upload after a partial item failure and sanitizes errors", async () => {
    const f = fixture(Array.from({ length: 51 }, (_, index) => report(String(1000 + index))));
    f.insertItems.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Authorization: private-api-token"));
    expect(await f.run()).toBe(1);
    expect(f.insertItems).toHaveBeenCalledTimes(2);
    expect(f.deleteUpload).toHaveBeenCalledTimes(1);
    expect(f.deleteUpload).toHaveBeenCalledWith(uploadId);
    expect(f.output()).toContain("already imported were removed");
    expect(f.output()).not.toContain("private-api-token");
  });

  test("reports the incomplete upload ID if its cleanup also fails", async () => {
    const f = fixture();
    f.insertItems.mockRejectedValue(new Error("private-api-token"));
    f.deleteUpload.mockRejectedValue(new Error("private-cleanup-token"));
    expect(await f.run()).toBe(1);
    expect(f.output()).toContain(`incomplete review upload is ${uploadId}`);
    expect(f.output()).not.toContain("private-api-token");
    expect(f.output()).not.toContain("private-cleanup-token");
  });

  test("does not attempt deletion when creating the upload fails", async () => {
    const f = fixture();
    f.createUpload.mockRejectedValue(new Error("private-api-token"));
    expect(await f.run()).toBe(1);
    expect(f.insertItems).not.toHaveBeenCalled();
    expect(f.deleteUpload).not.toHaveBeenCalled();
    expect(f.output()).not.toContain("private-api-token");
  });
});
