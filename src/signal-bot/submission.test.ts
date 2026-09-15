import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { SupabaseLogger } from "../api/supabaseClient";
import * as api from "../api/submitNote";
import * as sharedSubmission from "../pipeline/orchestration/submitNoteForTweet";
import { joinNoteWithSources } from "../pipeline/utils/noteLength";
import { createSignalRegistrar, createSignalSubmitter } from "./submission";
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
    queueSignalSubmission: mock(async (_tweetId: string): ReturnType<SupabaseLogger["queueSignalSubmission"]> => null),
    cancelSignalSubmission: mock(async (_tweetId: string) => {}),
    getNoteSubmissionCapacity: mock(async () => ({ cap: 10, used24h: 7, inFlight: 0, remaining: 3, reserve: 0, canSubmit: true, probe: false, signalQueued: 1, nextAttemptAt: null })),
    bulkInsertNewTweets: mock(async (_posts: unknown) => {}),
    createPipelineRun: mock(async (_data: unknown) => "pipeline-run-id"),
    completePipelineRun: mock(async (_id: string, _data: unknown) => {}),
    claimNoteSubmission: mock(async () => ({ status: "claimed", claimId: "claim-id",
      capacity: { cap: 10, used24h: 7, inFlight: 0, remaining: 3, reserve: 0, canSubmit: true, probe: false, signalQueued: 0, nextAttemptAt: null } })),
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
  test("registration alone publishes priority without preparing a run or posting", async () => {
    const { logger, queueSignalSubmission, createPipelineRun } = loggerFixture();
    const submit = spyOn(sharedSubmission, "submitNoteForTweet");
    expect(await createSignalRegistrar(logger)(conversationFixture())).toBeNull();
    expect(queueSignalSubmission).toHaveBeenCalledTimes(1);
    expect(createPipelineRun).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  test("a known submission settles locally before capacity checking or run preparation", async () => {
    const { logger, queueSignalSubmission, getNoteSubmissionCapacity, createPipelineRun } = loggerFixture();
    const capacity = await getNoteSubmissionCapacity();
    getNoteSubmissionCapacity.mockClear();
    queueSignalSubmission.mockResolvedValue({ status: "submission_busy", reason: "submitted", capacity });
    const submit = spyOn(sharedSubmission, "submitNoteForTweet");
    expect(await createSignalSubmitter(logger)(conversationFixture()))
      .toMatchObject({ status: "submission_busy", reason: "submitted" });
    expect(getNoteSubmissionCapacity).not.toHaveBeenCalled();
    expect(createPipelineRun).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  test("a full account registers priority without preparing or submitting another run", async () => {
    const { logger, getNoteSubmissionCapacity, queueSignalSubmission, createPipelineRun, cancelSignalSubmission } = loggerFixture();
    getNoteSubmissionCapacity.mockResolvedValue({ cap: 10, used24h: 10, inFlight: 0, remaining: 0,
      reserve: 0, canSubmit: false, probe: false, signalQueued: 1, nextAttemptAt: null });
    const submit = spyOn(sharedSubmission, "submitNoteForTweet");
    expect((await createSignalSubmitter(logger)(conversationFixture())).status).toBe("capacity_reserved");
    expect(queueSignalSubmission).toHaveBeenCalledWith("1234567890123456789");
    expect(createPipelineRun).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(cancelSignalSubmission).not.toHaveBeenCalled();
  });

  test("queue registration failure defers safely without an X attempt", async () => {
    const { logger, queueSignalSubmission, createPipelineRun } = loggerFixture();
    queueSignalSubmission.mockRejectedValue(new Error("database unavailable"));
    const submit = spyOn(sharedSubmission, "submitNoteForTweet");
    expect((await createSignalSubmitter(logger)(conversationFixture())).status).toBe("deferred");
    expect(createPipelineRun).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  test("retries reuse the persisted run and approved text after a limit rejection", async () => {
    const conversation = conversationFixture();
    const { logger, createPipelineRun, cancelSignalSubmission } = loggerFixture();
    const submit = spyOn(sharedSubmission, "submitNoteForTweet")
      .mockResolvedValueOnce({ status: "daily_limit" })
      .mockResolvedValueOnce({ status: "submitted", noteId: "note" });
    const callbacks = { onPrepared: (id: string) => { conversation.submissionRunId = id; }, onSubmitting: () => {} };
    const attempt = createSignalSubmitter(logger);
    expect((await attempt(conversation, callbacks)).status).toBe("daily_limit");
    expect(cancelSignalSubmission).not.toHaveBeenCalled();
    expect((await attempt(conversation, callbacks)).status).toBe("submitted");
    expect(createPipelineRun).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls.map(([candidate]) => candidate.tweetResult.pipelineRunId))
      .toEqual(["pipeline-run-id", "pipeline-run-id"]);
    expect(submit.mock.calls.map(([candidate]) => candidate.tweetResult.noteText))
      .toEqual([conversation.approval!.text, conversation.approval!.text]);
    expect(cancelSignalSubmission).toHaveBeenCalledTimes(1);
  });

  test("persists the prepared run and submitting state before the actual X call", async () => {
    const { logger, queueSignalSubmission } = loggerFixture();
    const order: string[] = [];
    queueSignalSubmission.mockImplementation(async () => { order.push("priority"); return null; });
    spyOn(api, "submitNote").mockImplementation(async () => { order.push("X"); return { data: { id: "note" } }; });
    const callbacks = { onPrepared: () => { order.push("prepared"); }, onSubmitting: () => { order.push("submitting"); } };
    expect((await createSignalSubmitter(logger)(conversationFixture(), callbacks)).status).toBe("submitted");
    expect(order).toEqual(["priority", "prepared", "submitting", "X"]);
  });

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
    expect(result.status).toBe("deferred");
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

  test("a daily-limit rejection leaves the prepared run queued", async () => {
    const { logger, completePipelineRun } = loggerFixture();
    completePipelineRun.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Outcome logging unavailable"));
    spyOn(console, "warn").mockImplementation(() => {});
    spyOn(sharedSubmission, "submitNoteForTweet").mockResolvedValue({ status: "daily_limit" });
    expect(await createSignalSubmitter(logger)(conversationFixture())).toEqual({ status: "daily_limit" });
    expect(completePipelineRun).toHaveBeenCalledTimes(1);
  });
});
