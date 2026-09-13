import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { SupabaseLogger } from "../../api/supabaseClient";
import * as api from "../../api/submitNote";
import type { SubmissionAdmission, SubmissionClaimOutcome } from "../capacity/submissionReserve";
import type { Candidate } from "./submitCandidates";
import { submitNoteForTweet } from "./submitNoteForTweet";

const capacity = { cap: 10, used24h: 6, inFlight: 0, remaining: 4, reserve: 3 };
const candidate: Candidate = {
  post: { id: "1234", author_id: "author", created_at: new Date().toISOString(), text: "claim", media: [] },
  tweetResult: { pipelineResult: null, outcome: "candidate", finalStage: "evaluation", scores: [], pipelineRunId: "run", noteText: "A sourced correction." },
  botId: "simple-bot",
};

function loggerMock() {
  const calls: string[] = [];
  const claimNoteSubmission = mock(async (): Promise<SubmissionAdmission> => {
    calls.push("claim");
    return { status: "claimed", claimId: "claim-id", capacity };
  });
  const finishNoteSubmissionClaim = mock(async (_id: string, status: SubmissionClaimOutcome, _noteId?: string | null, _reason?: string | null) => {
    calls.push(status);
  });
  const logNoteSubmission = mock(async () => { calls.push("log"); });
  const markCandidateSubmitted = mock(async () => {});
  const markCandidateExpired = mock(async () => {});
  const completePipelineRun = mock(async () => {});
  const countRecentSubmissions = mock(async () => 7);
  const getPipelineState = mock(async () => "10");
  const setPipelineState = mock(async () => {});
  const methods = { claimNoteSubmission, finishNoteSubmissionClaim, logNoteSubmission, markCandidateSubmitted,
    markCandidateExpired, completePipelineRun, countRecentSubmissions, getPipelineState, setPipelineState };
  return { logger: methods as unknown as SupabaseLogger, calls, ...methods };
}

beforeEach(() => {
  spyOn(console, "log").mockImplementation(() => {});
  spyOn(console, "warn").mockImplementation(() => {});
  spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => mock.restore());

describe("shared note submission admission", () => {
  test("claims automatic capacity before X and records acceptance before notes logging", async () => {
    const { logger, calls, claimNoteSubmission, finishNoteSubmissionClaim } = loggerMock();
    const submit = spyOn(api, "submitNote").mockImplementation(async () => { calls.push("X"); return { data: { id: "note" } }; });
    expect(await submitNoteForTweet(candidate, logger)).toEqual({ status: "submitted", noteId: "note" });
    expect(claimNoteSubmission).toHaveBeenCalledWith("1234", "automatic");
    expect(calls).toEqual(["claim", "X", "submitted", "log"]);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(finishNoteSubmissionClaim).toHaveBeenCalledWith("claim-id", "submitted", "note", null);
  });

  test("uses the same admission function for the explicit Signal lane", async () => {
    const { logger, claimNoteSubmission } = loggerMock();
    spyOn(api, "submitNote").mockResolvedValue({ data: { id: "note" } });
    await submitNoteForTweet(candidate, logger, { lane: "signal" });
    expect(claimNoteSubmission).toHaveBeenCalledWith("1234", "signal");
  });

  test.each([
    { status: "capacity_reserved", reason: "reserve", capacity },
    { status: "capacity_reserved", reason: "unknown_capacity", capacity: { ...capacity, cap: null, remaining: null } },
    { status: "submission_busy", reason: "uncertain", capacity },
  ] as Exclude<SubmissionAdmission, { status: "claimed" }>[])("never calls X when admission returns %j", async (admission) => {
    const { logger, claimNoteSubmission, finishNoteSubmissionClaim } = loggerMock();
    claimNoteSubmission.mockResolvedValue(admission);
    const submit = spyOn(api, "submitNote");
    expect(await submitNoteForTweet(candidate, logger)).toEqual(admission);
    expect(submit).not.toHaveBeenCalled();
    expect(finishNoteSubmissionClaim).not.toHaveBeenCalled();
  });

  test("database admission failure closes both lanes", async () => {
    const { logger, claimNoteSubmission } = loggerMock();
    claimNoteSubmission.mockRejectedValue(new Error("database unavailable"));
    const submit = spyOn(api, "submitNote");
    expect((await submitNoteForTweet(candidate, logger)).status).toBe("error");
    expect((await submitNoteForTweet(candidate, logger, { lane: "signal" })).status).toBe("error");
    expect(submit).not.toHaveBeenCalled();
  });

  test.each([undefined, 408, 500, 503])("retains uncertain capacity after a transport/server failure (%s), without retry", async (status) => {
    const { logger, finishNoteSubmissionClaim, completePipelineRun } = loggerMock();
    const submit = spyOn(api, "submitNote").mockRejectedValue({ message: "timeout", response: { status } });
    expect((await submitNoteForTweet(candidate, logger)).status).toBe("uncertain");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(finishNoteSubmissionClaim).toHaveBeenCalledWith("claim-id", "uncertain", null, "timeout");
    expect(completePipelineRun).not.toHaveBeenCalled();
  });

  test("an X response without a note ID is uncertain", async () => {
    const { logger, finishNoteSubmissionClaim } = loggerMock();
    spyOn(api, "submitNote").mockResolvedValue({ data: {} });
    expect((await submitNoteForTweet(candidate, logger)).status).toBe("uncertain");
    expect(finishNoteSubmissionClaim).toHaveBeenCalledWith("claim-id", "uncertain", null, "No note ID in X response");
  });

  test("a daily-limit rejection releases the claim and preserves observed limit updates", async () => {
    const { logger, finishNoteSubmissionClaim, setPipelineState } = loggerMock();
    spyOn(api, "submitNote").mockRejectedValue({ response: { status: 403, data: { detail: "daily limit exceeded" } } });
    expect(await submitNoteForTweet(candidate, logger)).toEqual({ status: "daily_limit" });
    expect(finishNoteSubmissionClaim.mock.calls[0]?.[1]).toBe("rejected");
    expect(setPipelineState).toHaveBeenCalledWith("writing_limit", "7");
    expect(setPipelineState).toHaveBeenCalledWith("limit_hit_value", "7");
  });

  test("an ineligible rejection releases capacity and expires the candidate", async () => {
    const { logger, finishNoteSubmissionClaim, markCandidateExpired } = loggerMock();
    spyOn(api, "submitNote").mockRejectedValue({ response: { status: 403, data: { detail: "post ineligible" } } });
    expect(await submitNoteForTweet(candidate, logger)).toEqual({ status: "expired", reason: "ineligible" });
    expect(finishNoteSubmissionClaim.mock.calls[0]?.[1]).toBe("rejected");
    expect(markCandidateExpired).toHaveBeenCalledWith("run", "ineligible");
  });

  test("accepted notes stay accepted if settlement and notes logging fail", async () => {
    const { logger, finishNoteSubmissionClaim, logNoteSubmission } = loggerMock();
    finishNoteSubmissionClaim.mockRejectedValue(new Error("write failed"));
    logNoteSubmission.mockRejectedValue(new Error("write failed"));
    const submit = spyOn(api, "submitNote").mockResolvedValue({ data: { id: "note" } });
    expect(await submitNoteForTweet(candidate, logger)).toEqual({ status: "submitted", noteId: "note" });
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
