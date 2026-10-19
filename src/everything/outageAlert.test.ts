import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { dbMock, dbState, resetDbState } from "./dbMock";

/* Covers when the feed run emails Nathan: the error signature, the rule that
 * tells a breakage of the whole system from one bad item, the 12-hour dedup,
 * the email itself, and that alerting never throws. The db module and fetch
 * are mocked, so no database or email service is reached. The error texts are
 * ones production recorded in September and October 2026. */

mock.module("./db", dbMock);

const {
  accountProblem,
  actionsRunUrl,
  alertIfItemsAreFailing,
  alertIsDue,
  alertOnSickMachine,
  composeAlertEmail,
  errorSignature,
  judgeItemErrors,
  machineOutage,
  openRouterLink,
  OUTAGE_STREAK,
  parseAlertLog,
  recordAlert,
  tallyFailures,
} = await import("./outageAlert");

const KEY_PAGE = "https://openrouter.ai/workspaces/default/keys/0123456789abcdef0123456789abcdef";
const keyLimit = (used: string) =>
  `/extract-claims failed: [model: openai/gpt-6-luna] 403 403 Key limit exceeded (monthly limit). Manage it using ${KEY_PAGE} $${used} of $1500.00 used; resets 2026-11-01T00:00:00.000Z.`;
const KEY_LIMIT = keyLimit("1503.25");
const MUSE_BLOCKED =
  '/extract-claims failed: [model: meta/muse-spark-1.3-contributor] 403 403 Provider returned error | body: {"message":"Provider returned error","code":403,"metadata":{"raw":"{\\"error\\":{\\"code\\":\\"user_blocked\\"}}"}}';
const YOUTUBE_QUOTA =
  'YouTube Data API videos failed (quotaExceeded): The request cannot be completed because you have exceeded your <a href="/youtube/v3/getting-started#quota">quota</a>.';
const PAGE_403 = "Fetch failed: HTTP 403 (last attempt: browser)";
const noTranscript = (id: string) => `No transcript available for https://www.youtube.com/watch?v=${id}`;
const youngVideo = (id: string) => `https://www.youtube.com/watch?v=${id}: no captions, but the video is young enough to still get captions`;
const unreachable = (id: string) =>
  `YouTube could not be reached for https://www.youtube.com/watch?v=${id}: WARNING: [youtube] ${id}: Unable to download webpage: HTTP Error 429: Too Many Requests`;
const VIDEO_IDS = ["tJbzMqJGH4k", "-6pu6ihNp-4", "HCIWrgdl1mg", "Lc06dK-JiAY", "Fb7dcsKc8zU", "viEvEPw-yuI"];

const finished = (error: string | null) => ({
  status: error === null ? ("done" as const) : ("error" as const),
  error,
  processed_at: "2026-10-19T12:00:00Z",
});

describe("errorSignature", () => {
  test("the same failure on different videos has one signature", () => {
    const signatures = VIDEO_IDS.map((id) => errorSignature(unreachable(id)));
    expect(new Set(signatures).size).toBe(1);
    expect(signatures[0]).toContain("HTTP Error 429");
  });

  test("links, ids, amounts, times and durations are taken out", () => {
    expect(errorSignature(KEY_LIMIT)).toBe(errorSignature(KEY_LIMIT.replace(/0123456789abcdef/g, "fedcba9876543210")));
    // The error quotes the key's spend, which differed between items of the
    // same October 2026 outage. It must not split one outage into several.
    expect(errorSignature(keyLimit("1502.71"))).toBe(errorSignature(keyLimit("1503.25")));
    expect(errorSignature("item 6c12c005-7f2c-4cec-b1c1-c201f9f96a83 failed")).toBe(
      errorSignature("item 3d551655-aaaa-4bbb-8ccc-0123456789ab failed"),
    );
    expect(errorSignature("A reader request has waited 17m03s unconsumed.")).toBe(
      errorSignature("A reader request has waited 2h15m unconsumed."),
    );
    expect(errorSignature("timed out at 2026-10-19T18:54:53.344Z after 120000 ms")).toBe(
      errorSignature("timed out at 2026-10-17T01:02:03Z after 95000 ms"),
    );
  });

  test("status codes and model names stay, so different failures differ", () => {
    expect(errorSignature(PAGE_403)).not.toBe(errorSignature("Fetch failed: HTTP 404 (last attempt: browser)"));
    expect(errorSignature(KEY_LIMIT)).toContain("[model: openai/gpt-6-luna] 403 403 Key limit exceeded");
  });
});

describe("accountProblem", () => {
  test("names the provider account problem", () => {
    expect(accountProblem(KEY_LIMIT)).toBe("OpenRouter key limit");
    expect(accountProblem("/extract-claims failed: [model: openai/gpt-6-luna] 402 402 Insufficient credits")).toBe("OpenRouter out of credits");
    expect(accountProblem("[model: openai/gpt-6-luna] 401 401 No auth credentials found")).toBe("OpenRouter API key rejected");
    expect(accountProblem(YOUTUBE_QUOTA)).toBe("YouTube Data API quota exceeded");
    expect(accountProblem(MUSE_BLOCKED)).toBe("OpenRouter account blocked");
    expect(accountProblem("API key not valid. Please pass a valid API key.")).toBe("API key rejected");
  });

  test("one item's own failures are not account problems", () => {
    for (const error of [
      PAGE_403,
      // A paywall answers 401 or 402 too, but that is one page, not our account.
      "Fetch failed: HTTP 402 (last attempt: browser)",
      "Fetch failed: HTTP 401 (last attempt: browser)",
      "Fetch failed for https://example.com/billing/key-limit-exceeded",
      noTranscript("tJbzMqJGH4k"),
      unreachable("tJbzMqJGH4k"),
      "null is not an object (evaluating 'dump.subtitles')",
    ]) {
      expect(accountProblem(error)).toBeNull();
    }
  });
});

describe("judgeItemErrors", () => {
  test("a provider account problem is an outage at the first item", () => {
    const outage = judgeItemErrors([finished(KEY_LIMIT), finished(null), finished(null)]);
    expect(outage?.kind).toBe("account");
    expect(outage?.label).toBe("OpenRouter key limit");
  });

  test("the October 2026 key-limit outage, mixed with videos without captions, is caught", () => {
    const recent = [KEY_LIMIT, noTranscript("a1"), KEY_LIMIT, noTranscript("b2"), noTranscript("c3")].map(finished);
    expect(judgeItemErrors(recent)?.kind).toBe("account");
  });

  test(`the same error on the last ${OUTAGE_STREAK} items is an outage`, () => {
    const outage = judgeItemErrors(VIDEO_IDS.slice(0, OUTAGE_STREAK).map((id) => finished(unreachable(id))));
    expect(outage?.kind).toBe("repeated");
    expect(outage?.label).toBe(`the same error on the last ${OUTAGE_STREAK} items`);
  });

  test("a shorter run, or one broken by another outcome, is not", () => {
    const four = VIDEO_IDS.slice(0, OUTAGE_STREAK - 1).map((id) => finished(unreachable(id)));
    expect(judgeItemErrors(four)).toBeNull();
    expect(judgeItemErrors([...four, finished(null)])).toBeNull();
    expect(judgeItemErrors([...four, finished(PAGE_403)])).toBeNull();
  });

  test("a run of videos without captions is never an outage", () => {
    expect(judgeItemErrors(VIDEO_IDS.map((id) => finished(noTranscript(id))))).toBeNull();
    expect(judgeItemErrors(VIDEO_IDS.map((id) => finished(youngVideo(id))))).toBeNull();
  });

  test("one bad page is not an outage, and neither is a quiet queue", () => {
    expect(judgeItemErrors([PAGE_403, null, null, null, null].map(finished))).toBeNull();
    expect(judgeItemErrors([null, null].map(finished))).toBeNull();
    expect(judgeItemErrors([])).toBeNull();
  });
});

describe("dedup", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3600_000).toISOString();

  test("an error is due unless it was emailed in the last 12 hours", () => {
    expect(alertIsDue({}, "sig", now)).toBe(true);
    expect(alertIsDue({ sig: hoursAgo(11) }, "sig", now)).toBe(false);
    expect(alertIsDue({ sig: hoursAgo(12) }, "sig", now)).toBe(true);
    expect(alertIsDue({ other: hoursAgo(1) }, "sig", now)).toBe(true);
    expect(alertIsDue({ sig: "not a time" }, "sig", now)).toBe(true);
  });

  test("recording an email drops the entries that are due again", () => {
    expect(recordAlert({ old: hoursAgo(13), recent: hoursAgo(2) }, "new", now)).toEqual({
      recent: hoursAgo(2),
      new: now.toISOString(),
    });
  });

  test("a stored value that is not a log reads as empty", () => {
    expect(parseAlertLog(null)).toEqual({});
    expect(parseAlertLog("not json")).toEqual({});
    expect(parseAlertLog("[1]")).toEqual({});
    expect(parseAlertLog('{"sig":"2026-10-19T00:00:00.000Z"}')).toEqual({ sig: "2026-10-19T00:00:00.000Z" });
  });
});

describe("the email", () => {
  const now = new Date("2026-10-19T12:00:00Z");

  test("tallies the items that failed the same way", () => {
    const tally = tallyFailures(
      [
        { error: KEY_LIMIT, processed_at: "2026-10-16T21:06:00Z" },
        { error: KEY_LIMIT, processed_at: "2026-10-19T11:00:00Z" },
        { error: KEY_LIMIT, processed_at: "2026-10-19T10:00:00Z" },
        { error: PAGE_403, processed_at: "2026-10-19T11:30:00Z" },
        { error: null, processed_at: "2026-10-19T11:40:00Z" },
      ],
      errorSignature(KEY_LIMIT),
      now,
    );
    expect(tally).toEqual({ last24h: 2, firstSeen: "2026-10-16T21:06:00Z" });
  });

  test("a key-limit email names the key and links its page and the run", () => {
    const outage = judgeItemErrors([finished(KEY_LIMIT)])!;
    const email = composeAlertEmail(outage, {
      failures: { last24h: 42, firstSeen: "2026-10-16T21:06:30Z" },
      runUrl: "https://github.com/Goodheart-Labs/cn-return-bot/actions/runs/123",
    });
    expect(email.subject).toBe("Common Notes checker down: OpenRouter key limit");
    expect(email.text).toContain(KEY_LIMIT);
    expect(email.text).toContain("Items failed with this error in the last 24 hours: 42, the first at 2026-10-16 21:06 UTC.");
    expect(email.text).toContain("Actions run: https://github.com/Goodheart-Labs/cn-return-bot/actions/runs/123");
    expect(email.text).toContain(`OpenRouter key: ${KEY_PAGE}`);
  });

  test("a machine email has no item count and no key link", () => {
    const email = composeAlertEmail(machineOutage("The claim-check service is stuck. Failing the run so this is seen."), {
      failures: null,
      runUrl: null,
    });
    expect(email.subject).toBe("Common Notes checker down: services machine unhealthy");
    expect(email.text).not.toContain("Items failed");
    expect(email.text).not.toContain("OpenRouter");
    expect(email.text).not.toContain("\n\n\n");
  });

  test("links come from the environment and the error", () => {
    expect(actionsRunUrl({ GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "9" })).toBe(
      "https://github.com/o/r/actions/runs/9",
    );
    expect(actionsRunUrl({})).toBeNull();
    expect(openRouterLink(KEY_LIMIT)).toBe(KEY_PAGE);
    expect(openRouterLink(`Manage it using ${KEY_PAGE}.`)).toBe(KEY_PAGE);
    expect(openRouterLink(PAGE_403)).toBeNull();
  });
});

describe("alerting", () => {
  const realFetch = globalThis.fetch;
  const savedKey = process.env.RESEND_API_KEY;
  let sent: { url: string; body: Record<string, unknown> }[] = [];
  let answer: () => Response = () => new Response("{}", { status: 200 });

  beforeEach(() => {
    resetDbState();
    sent = [];
    answer = () => new Response("{}", { status: 200 });
    process.env.RESEND_API_KEY = "test-key";
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return answer();
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
  });

  test("a key-limit failure is emailed once, and the next run within 12 hours sends nothing", async () => {
    dbState.finishedItems = [finished(KEY_LIMIT), finished(null)];
    dbState.erroredItems = [{ error: KEY_LIMIT, processed_at: new Date().toISOString() }];
    await alertIfItemsAreFailing();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://api.resend.com/emails");
    expect(sent[0]!.body).toMatchObject({
      from: "Common Notes alerts <notes@commonnotes.net>",
      to: ["nathan@goodheartlabs.com"],
      subject: "Common Notes checker down: OpenRouter key limit",
    });
    expect(sent[0]!.body.text).toContain("in the last 24 hours: 1,");
    await alertIfItemsAreFailing();
    expect(sent).toHaveLength(1);
  });

  test("the same error is emailed again once 12 hours have passed", async () => {
    dbState.finishedItems = [finished(KEY_LIMIT)];
    const thirteenHoursAgo = new Date(Date.now() - 13 * 3600_000).toISOString();
    dbState.pipelineState.everything_outage_alerts = JSON.stringify({ [errorSignature(KEY_LIMIT)]: thirteenHoursAgo });
    await alertIfItemsAreFailing();
    expect(sent).toHaveLength(1);
  });

  test("a different breakage is emailed within the 12 hours", async () => {
    dbState.finishedItems = [finished(KEY_LIMIT)];
    await alertIfItemsAreFailing();
    await alertOnSickMachine(new Error("The extraction service is stuck. Failing the run so this is seen."));
    expect(sent.map((email) => email.body.subject)).toEqual([
      "Common Notes checker down: OpenRouter key limit",
      "Common Notes checker down: services machine unhealthy",
    ]);
  });

  test("one bad item sends nothing", async () => {
    dbState.finishedItems = [PAGE_403, null, null, null, null].map(finished);
    await alertIfItemsAreFailing();
    expect(sent).toHaveLength(0);
  });

  test("without RESEND_API_KEY nothing is sent or remembered", async () => {
    delete process.env.RESEND_API_KEY;
    dbState.finishedItems = [finished(KEY_LIMIT)];
    await alertIfItemsAreFailing();
    expect(sent).toHaveLength(0);
    expect(dbState.pipelineState).toEqual({});
  });

  test("a failing email service never throws, and the next run tries again", async () => {
    dbState.finishedItems = [finished(KEY_LIMIT)];
    answer = () => new Response("rate limited", { status: 429 });
    await alertIfItemsAreFailing();
    expect(dbState.pipelineState).toEqual({});
    answer = () => {
      throw new Error("network down");
    };
    await alertOnSickMachine(new Error("The claim-check service is stuck."));
    answer = () => new Response("{}", { status: 200 });
    await alertIfItemsAreFailing();
    expect(sent).toHaveLength(3);
    expect(Object.keys(dbState.pipelineState)).toEqual(["everything_outage_alerts"]);
  });
});
