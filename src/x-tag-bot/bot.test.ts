import { describe, expect, mock, test } from "bun:test";
import type { Post } from "../api/fetchEligiblePosts";
import { outcomeToResult, type PipelineOutcome } from "../bots/types";
import type { TweetComputeOutput } from "../pipeline/orchestration/processTweet";
import type { SubmissionResult } from "../pipeline/orchestration/submitNoteForTweet";
import { MAX_WAIT_MS, TagBot, withoutLeadingMentions, type TagBotDeps } from "./bot";
import type { Revision } from "./models";
import type { ReplyKind } from "./prompts";
import { createMemoryStore } from "./store";
import type { IncomingPost } from "./x";

const TARGET = "500";
const DRAFT = { text: "Dharavi still houses about 1 million people.", sources: ["https://en.wikipedia.org/wiki/Dharavi"] };
const BETTER = { text: "Greater Mumbai counted 5.2 million slum residents in 2011.", sources: ["https://example.gov/census.pdf"] };

function checkAnswer(outcome: PipelineOutcome): TweetComputeOutput {
  const post = { id: TARGET, text: "The slums are largely gone." };
  return {
    pipelineResult: outcomeToResult(post, "simple-bot", outcome),
    outcome: outcome.type === "note" ? "candidate" : "rejected",
    finalStage: "candidate", scores: [], flatLog: {}, bot: { name: "Simple Bot" }, postContext: "The rendered post",
  };
}

function harness(overrides: Partial<TagBotDeps> = {}) {
  let clock = new Date("2026-10-06T12:00:00Z");
  const store = createMemoryStore(() => clock);
  const replies: Array<{ id: string; text: string; parent: string }> = [];
  let nextId = 1000;
  const kinds: ReplyKind[] = [];
  const revisions: Revision[] = [];
  const deps: TagBotDeps = {
    store,
    models: {
      classify: mock(async () => kinds.shift() ?? "other"),
      writeNoNoteReply: mock(async () => "The figures check out."),
      revise: mock(async (): Promise<Revision> => revisions.shift() ?? { action: "keep", reply: "The draft stays." }),
    },
    botUserId: "bot",
    botHandle: "CommonNotesBot",
    postReply: mock(async (text: string, parent: string) => {
      const id = String(nextId++);
      replies.push({ id, text, parent });
      return id;
    }),
    fetchPost: mock(async (id: string): Promise<Post> => ({ id, author_id: "author", created_at: "2026-10-06T10:00:00Z", text: "The slums are largely gone.", media: [] })),
    checkTweet: mock(async () => checkAnswer({ type: "note", noteText: DRAFT.text, sources: DRAFT.sources, verified: false, searchResults: "Findings" })),
    recordRun: mock(async () => undefined),
    isEligible: mock(async () => true),
    submit: mock(async (): Promise<SubmissionResult> => ({ status: "submitted", noteId: "note-1" })),
    now: () => clock,
    ...overrides,
  };
  const bot = new TagBot(deps);
  let postId = 1;
  const post = (author: string, text: string, repliedToId: string): IncomingPost =>
    ({ event: "mention", id: String(postId++), text, authorId: author, authorHandle: author, repliedToId });
  return {
    bot, deps, store, replies, kinds, revisions, post,
    lastReply: () => replies.at(-1)!,
    advance: (ms: number) => { clock = new Date(clock.getTime() + ms); },
  };
}

/** Tags the bot under the target post and returns the id of its draft. */
async function tagged(h: ReturnType<typeof harness>, author = "priya"): Promise<string> {
  await h.bot.receive(h.post(author, "@CommonNotesBot is this true? Dharavi still exists", TARGET));
  return h.lastReply().id;
}

describe("a tag", () => {
  test("gets a draft, researched with the tagger's words and the bot's picks", async () => {
    const h = harness();
    await tagged(h);
    expect(h.deps.checkTweet).toHaveBeenCalledWith(expect.objectContaining({ id: TARGET }),
      { handle: "priya", text: "is this true? Dharavi still exists" });
    expect(h.lastReply().text).toStartWith(`Draft Community Note:\n\n${DRAFT.text}`);
    expect(h.lastReply().text).toEndWith(`Reply "approve" and I'll submit it. Or reply with what to change.`);
    const [thread] = await h.store.threadsOnTarget(TARGET);
    expect(thread).toMatchObject({ postContext: "The rendered post", findings: "Findings" });
  });

  test("on a post X won't take our notes on, the draft asks people to request one", async () => {
    const h = harness({ isEligible: mock(async () => false) });
    await tagged(h);
    expect(h.lastReply().text).toContain("You can request a Community Note in the post's menu.");
  });

  test("gets a no-note answer when the research finds nothing to correct", async () => {
    const h = harness({ checkTweet: mock(async () => checkAnswer({ type: "no_correction", reason: "Accurate", searchResults: "Accurate" })) });
    await tagged(h);
    expect(h.deps.models.writeNoNoteReply).toHaveBeenCalledWith("The rendered post", "Accurate");
    expect(h.lastReply().text).toStartWith("The figures check out.");
  });

  test("a second tag on the same post repeats the answer without new research", async () => {
    const h = harness();
    await tagged(h);
    await tagged(h, "dan");
    expect(h.deps.checkTweet).toHaveBeenCalledTimes(1);
    expect(h.replies.map((r) => r.text)).toEqual([h.replies[0]!.text, h.replies[0]!.text]);
  });

  test("a post that already has our note gets its link", async () => {
    const h = harness();
    h.store.notes.set(TARGET, "note-9");
    await tagged(h);
    expect(h.lastReply().text).toContain("https://x.com/i/communitynotes/note-9");
    expect(h.deps.checkTweet).not.toHaveBeenCalled();
  });

  test("the same tag delivered twice is answered once", async () => {
    const h = harness();
    const tag = h.post("priya", "@CommonNotesBot check this", TARGET);
    await h.bot.receive(tag);
    await h.bot.receive(tag);
    expect(h.replies).toHaveLength(1);
  });

  test("a reply event that is not under a bot post is ignored", async () => {
    const h = harness();
    await h.bot.receive({ ...h.post("priya", "nice", TARGET), event: "reply" });
    expect(h.replies).toHaveLength(0);
  });
});

describe("replies to the bot", () => {
  test("anything else gets no reply", async () => {
    const h = harness();
    const draft = await tagged(h);
    await h.bot.receive(h.post("raj", "lol", draft));
    expect(h.replies).toHaveLength(1);
  });

  test("feedback gets a revised draft with the revision's reply above it", async () => {
    const h = harness();
    const draft = await tagged(h);
    h.kinds.push("feedback");
    h.revisions.push({ action: "revise", reply: "Good point, here is an official source.", note: BETTER });
    await h.bot.receive(h.post("mohan", "use an official source", draft));
    expect(h.deps.models.revise).toHaveBeenCalledWith(expect.objectContaining({
      current: { kind: "draft", ...DRAFT }, improveAndApprove: false,
      thread: [expect.objectContaining({ handle: "priya" }), expect.objectContaining({ handle: "CommonNotesBot" }), { handle: "mohan", text: "use an official source" }],
    }));
    expect(h.lastReply().text).toStartWith("Good point, here is an official source.\n\nDraft Community Note:");
  });

  test("an approval from the tagger submits the draft and links the note", async () => {
    const h = harness();
    const draft = await tagged(h);
    h.kinds.push("approve");
    await h.bot.receive(h.post("priya", "approve", draft));
    expect(h.deps.submit).toHaveBeenCalledWith(expect.objectContaining({ id: TARGET }), DRAFT);
    expect(h.lastReply().text).toStartWith("Submitted.");
  });

  test("an approval from someone off the draft's path is refused", async () => {
    const h = harness();
    const draft = await tagged(h);
    h.kinds.push("approve");
    await h.bot.receive(h.post("raj", "approve", draft));
    expect(h.deps.submit).not.toHaveBeenCalled();
    expect(h.lastReply().text).toStartWith("Only the person who asked for this note");
  });

  test("an approval of a no-note answer counts as feedback", async () => {
    const h = harness({ checkTweet: mock(async () => checkAnswer({ type: "no_correction", reason: "Accurate" })) });
    const answer = await tagged(h);
    h.kinds.push("approve");
    await h.bot.receive(h.post("priya", "approve", answer));
    expect(h.deps.submit).not.toHaveBeenCalled();
    expect(h.deps.models.revise).toHaveBeenCalledTimes(1);
  });

  test("improve and approve revises, submits the new version and shows it in one reply", async () => {
    const h = harness();
    const draft = await tagged(h);
    h.kinds.push("improve_and_approve");
    h.revisions.push({ action: "revise", reply: "Done, I swapped the source.", note: BETTER });
    await h.bot.receive(h.post("priya", "approve but use an official source", draft));
    expect(h.deps.models.revise).toHaveBeenCalledWith(expect.objectContaining({ improveAndApprove: true }));
    expect(h.deps.submit).toHaveBeenCalledWith(expect.anything(), BETTER);
    expect(h.replies).toHaveLength(2);
    expect(h.lastReply().text).toContain("I made the change and submitted this version:");
  });

  test("improve and approve submits nothing when the revision keeps the draft", async () => {
    const h = harness();
    const draft = await tagged(h);
    h.kinds.push("improve_and_approve");
    await h.bot.receive(h.post("priya", "approve but say it never existed", draft));
    expect(h.deps.submit).not.toHaveBeenCalled();
    expect(h.lastReply().text).toBe("The draft stays.");
  });
});

describe("waiting approvals", () => {
  test("an approval waits while the daily limit is full and goes in once there is room", async () => {
    const submit = mock(async (): Promise<SubmissionResult> => ({ status: "daily_limit" }));
    const h = harness({ submit });
    const draft = await tagged(h);
    h.kinds.push("approve");
    const approval = h.post("priya", "approve", draft);
    await h.bot.receive(approval);
    expect(h.lastReply().text).toStartWith("Approved. X's daily limit");
    submit.mockImplementation(async () => ({ status: "submitted", noteId: "note-1" }));
    await h.bot.tick();
    expect(h.lastReply()).toMatchObject({ parent: approval.id, text: expect.stringMatching(/^Submitted\./) });
  });

  test("an approval waits for the post to become eligible", async () => {
    const isEligible = mock(async () => false);
    const h = harness({ isEligible });
    const draft = await tagged(h);
    h.kinds.push("approve");
    await h.bot.receive(h.post("priya", "approve", draft));
    expect(h.lastReply().text).toContain("X doesn't take notes from me on this post yet");
    expect(h.deps.submit).not.toHaveBeenCalled();
    isEligible.mockImplementation(async () => true);
    await h.bot.tick();
    expect(h.lastReply().text).toStartWith("Submitted.");
  });

  test("the newest of several approvals goes in, and the others get its link", async () => {
    const submit = mock(async (): Promise<SubmissionResult> => ({ status: "daily_limit" }));
    const h = harness({ submit });
    const draft1 = await tagged(h);
    h.kinds.push("approve");
    const first = h.post("priya", "approve", draft1);
    await h.bot.receive(first);
    h.kinds.push("feedback");
    h.revisions.push({ action: "revise", reply: "Here is a better source.", note: BETTER });
    await h.bot.receive(h.post("mohan", "better source please", draft1));
    const draft2 = h.lastReply().id;
    h.kinds.push("approve");
    const second = h.post("mohan", "approve", draft2);
    await h.bot.receive(second);

    submit.mockImplementation(async () => ({ status: "submitted", noteId: "note-1" }));
    await h.bot.tick();
    expect(submit).toHaveBeenLastCalledWith(expect.anything(), BETTER);
    const answers = new Map(h.replies.map((r) => [r.parent, r.text]));
    expect(answers.get(second.id)).toStartWith("Submitted.");
    expect(answers.get(first.id)).toContain(`a different draft on this post, and that one was submitted`);
    expect(answers.get(first.id)).toContain(`https://x.com/i/status/${draft2}`);
  });

  test("an approval that still waits after three hours gets the gave-up reply", async () => {
    const h = harness({ submit: mock(async (): Promise<SubmissionResult> => ({ status: "daily_limit" })) });
    const draft = await tagged(h);
    h.kinds.push("approve");
    await h.bot.receive(h.post("priya", "approve", draft));
    h.advance(MAX_WAIT_MS + 60_000);
    await h.bot.tick();
    expect(h.lastReply().text).toStartWith("I couldn't submit this note within 3 hours");
    const count = h.replies.length;
    await h.bot.tick();
    expect(h.replies).toHaveLength(count);
  });

  test("an approval after the submission gets the link of the note that went in", async () => {
    const h = harness();
    const draft = await tagged(h);
    h.kinds.push("approve");
    await h.bot.receive(h.post("priya", "approve", draft));
    h.store.notes.set(TARGET, "note-1");
    h.kinds.push("approve");
    await h.bot.receive(h.post("priya", "approve again", draft));
    expect(h.deps.submit).toHaveBeenCalledTimes(1);
    expect(h.lastReply().text).toStartWith("A note from me is already submitted on this post");
  });
});

test("leading mentions are stripped from the tagger's comment", () => {
  expect(withoutLeadingMentions("@CommonNotesBot @dan is this true?")).toBe("is this true?");
  expect(withoutLeadingMentions("is this true @CommonNotesBot")).toBe("is this true @CommonNotesBot");
});
