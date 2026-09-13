import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { SupabaseLogger } from "../api/supabaseClient";
import * as api from "../api/submitNote";
import * as sharedSubmission from "../pipeline/orchestration/submitNoteForTweet";
import { joinNoteWithSources } from "../pipeline/utils/noteLength";
import { createSignalSubmitter } from "./submission";
import type { Conversation } from "./store";

function conversationFixture(): Conversation {
  const draft = {
    text: "This happened  in 2017.", sources: ["https://example.org/z-record", "https://example.org/a-record"],
    version: 3, shownAt: 1_000,
  };
  return {
    id: 4, tweetId: "1234567890123456789", status: "submitting", nextVersion: 4, draft,
    inspection: {
      tweetId: "1234567890123456789", access: "readable", eligibility: "unconfirmed", detail: "Readable tweet",
      post: { id: "1234567890123456789", author_id: "42", created_at: "2026-09-12T12:00:00Z", text: "A public claim", media: [] },
    },
    history: [{ role: "user", content: "PRIVATE_GROUP_MESSAGE" }],
    research: "PRIVATE_RESEARCH_DISCUSSION",
    approval: { sender: "PRIVATE_SENDER_UUID", timestamp: 2_000, version: draft.version,
      text: joinNoteWithSources(draft.text, draft.sources) },
  };
}

function loggerFixture() {
  const methods = {
    bulkInsertNewTweets: mock(async (_posts: unknown) => {}),
    createPipelineRun: mock(async (_data: unknown) => "pipeline-run-id"),
    completePipelineRun: mock(async (_id: string, _data: unknown) => {}),
    claimNoteSubmission: mock(async () => ({ status: "claimed", claimId: "claim-id",
      capacity: { cap: 10, used24h: 7, inFlight: 0, remaining: 3, reserve: 3 } })),
    finishNoteSubmissionClaim: mock(async () => {}),
    logNoteSubmission: mock(async () => {}),
    markCandidateSubmitted: mock(async () => {}),
    countRecentSubmissions: mock(async () => 8),
    getPipelineState: mock(async () => "10"),
    setPipelineState: mock(async () => {}),
  };
  return { logger: methods as unknown as SupabaseLogger, ...methods };
}

afterEach(() => mock.restore());

describe("approved Signal submission", () => {
  test("passes the exact approved text and source order through the Signal lane", async () => {
    const fixture = conversationFixture();
    const { logger } = loggerFixture();
    const submit = spyOn(sharedSubmission, "submitNoteForTweet").mockResolvedValue({ status: "submitted", noteId: "note-id" });
    const before = JSON.stringify(fixture);
    expect(await createSignalSubmitter(logger)(fixture)).toEqual({ status: "submitted", noteId: "note-id" });
    expect(submit).toHaveBeenCalledTimes(1);
    const [candidate, passedLogger, options] = submit.mock.calls[0]!;
    expect(candidate.post.id).toBe(fixture.tweetId);
    expect(candidate.tweetResult.noteText).toBe("This happened  in 2017. https://example.org/z-record https://example.org/a-record");
    expect(candidate.sourceUrl).toBe("https://example.org/z-record https://example.org/a-record");
    expect(candidate.tweetResult.pipelineRunId).toBe("pipeline-run-id");
    expect(passedLogger).toBe(logger);
    expect(options).toEqual({ lane: "signal" });
    expect(JSON.stringify(fixture)).toBe(before);
  });

  test.each(["missing", "version", "text"])("an approval with %s mismatch never reaches the database or API", async (kind) => {
    const fixture = conversationFixture();
    if (kind === "missing") fixture.approval = undefined;
    else if (kind === "version") fixture.approval!.version = 2;
    else fixture.approval!.text = "Unapproved replacement text";
    const { logger, bulkInsertNewTweets } = loggerFixture();
    const submit = spyOn(sharedSubmission, "submitNoteForTweet").mockImplementation(async () => { throw new Error("Must not submit"); });
    expect((await createSignalSubmitter(logger)(fixture)).status).toBe("error");
    expect(submit).not.toHaveBeenCalled();
    expect(bulkInsertNewTweets).not.toHaveBeenCalled();
  });

  test.each(["post", "conversation"])("a mismatched %s tweet ID never reaches the database or API", async (field) => {
    const fixture = conversationFixture();
    if (field === "post") fixture.inspection!.post!.id = "9876543210987654321";
    else fixture.tweetId = "9876543210987654321";
    const { logger, bulkInsertNewTweets } = loggerFixture();
    const submit = spyOn(sharedSubmission, "submitNoteForTweet").mockImplementation(async () => { throw new Error("Must not submit"); });
    expect((await createSignalSubmitter(logger)(fixture)).status).toBe("error");
    expect(submit).not.toHaveBeenCalled();
    expect(bulkInsertNewTweets).not.toHaveBeenCalled();
  });

  test.each(["tweet", "run", "completion"])("a failure preparing the %s database row never calls X", async (stage) => {
    const { logger, bulkInsertNewTweets, createPipelineRun, completePipelineRun } = loggerFixture();
    if (stage === "tweet") bulkInsertNewTweets.mockRejectedValue(new Error("DB unavailable"));
    if (stage === "run") createPipelineRun.mockRejectedValue(new Error("DB unavailable"));
    if (stage === "completion") completePipelineRun.mockRejectedValue(new Error("DB unavailable"));
    const submit = spyOn(sharedSubmission, "submitNoteForTweet").mockImplementation(async () => { throw new Error("Must not submit"); });
    const result = await createSignalSubmitter(logger)(conversationFixture());
    expect(result.status).toBe("error");
    expect(submit).not.toHaveBeenCalled();
  });

  test("private group history, research and member identity never enter shared database writes", async () => {
    const { logger, bulkInsertNewTweets, createPipelineRun, completePipelineRun } = loggerFixture();
    const submit = spyOn(sharedSubmission, "submitNoteForTweet").mockResolvedValue({ status: "submitted", noteId: "note-id" });
    await createSignalSubmitter(logger)(conversationFixture());
    const written = JSON.stringify([
      bulkInsertNewTweets.mock.calls, createPipelineRun.mock.calls, completePipelineRun.mock.calls,
      submit.mock.calls.map(([candidate]) => candidate),
    ]);
    expect(written).not.toContain("PRIVATE_GROUP_MESSAGE");
    expect(written).not.toContain("PRIVATE_RESEARCH_DISCUSSION");
    expect(written).not.toContain("PRIVATE_SENDER_UUID");
    expect(written).toContain("draft_version");
    expect(written).toContain("This happened  in 2017.");
  });

  test("an accepted X note remains submitted when subsequent logging fails", async () => {
    const { logger, finishNoteSubmissionClaim, logNoteSubmission, markCandidateSubmitted } = loggerFixture();
    finishNoteSubmissionClaim.mockRejectedValue(new Error("Claim logging unavailable"));
    logNoteSubmission.mockRejectedValue(new Error("Notes logging unavailable"));
    markCandidateSubmitted.mockRejectedValue(new Error("Run logging unavailable"));
    spyOn(console, "error").mockImplementation(() => {});
    const post = spyOn(api, "submitNote").mockResolvedValue({ data: { id: "accepted-note-id" } });
    const result = await createSignalSubmitter(logger)(conversationFixture());
    expect(result).toEqual({ status: "submitted", noteId: "accepted-note-id" });
    expect(post).toHaveBeenCalledTimes(1);
    expect(logNoteSubmission).toHaveBeenCalledTimes(1);
    expect(markCandidateSubmitted).toHaveBeenCalledTimes(1);
  });

  test("logging a rejected attempt cannot replace the actual submission outcome", async () => {
    const { logger, completePipelineRun } = loggerFixture();
    completePipelineRun.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Outcome logging unavailable"));
    spyOn(console, "warn").mockImplementation(() => {});
    spyOn(sharedSubmission, "submitNoteForTweet").mockResolvedValue({ status: "daily_limit" });
    expect(await createSignalSubmitter(logger)(conversationFixture())).toEqual({ status: "daily_limit" });
    expect(completePipelineRun).toHaveBeenCalledTimes(2);
  });
});
