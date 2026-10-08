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
const NOTE = { text: "Dharavi still houses about 1 million people.", sources: ["https://en.wikipedia.org/wiki/Dharavi"] };
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
      revise: mock(async (): Promise<Revision> => revisions.shift() ?? { action: "keep", reply: "The note stays." }),
    },
    botUserId: "bot",
    botHandle: "CommonNotesBot",
    postReply: mock(async (text: string, parent: string) => {
      const id = String(nextId++);
      replies.push({ id, text, parent });
      return id;
    }),
    fetchPost: mock(async (id: string): Promise<Post> => ({ id, author_id: "author", created_at: "2026-10-06T10:00:00Z", text: "The slums are largely gone.", media: [] })),
    checkTweet: mock(async () => checkAnswer({ type: "note", noteText: NOTE.text, sources: NOTE.sources, verified: false, searchResults: "Findings" })),
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

/** Tags the bot under the target post and returns the id of its answer. */
async function tagged(h: ReturnType<typeof harness>, author = "priya"): Promise<string> {
  await h.bot.receive(h.post(author, "@CommonNotesBot is this true? Dharavi still exists", TARGET));
  return h.lastReply().id;
}

describe("a tag", () => {
  test("is researched with the tagger's words and the note goes in right away", async () => {
    const h = harness();
    await tagged(h);
    expect(h.deps.checkTweet).toHaveBeenCalledWith(expect.objectContaining({ id: TARGET }),
      { handle: "priya", text: "is this true? Dharavi still exists" });
    expect(h.deps.submit).toHaveBeenCalledWith(expect.objectContaining({ id: TARGET }), NOTE);
    expect(h.replies).toHaveLength(1);
    expect(h.lastReply().text).toStartWith(`I submitted this Community Note:\n\n${NOTE.text}`);
    expect(h.lastReply().text).toContain("https://x.com/i/communitynotes/note-1");
  });

  test("on a post X won't take our notes on, the note waits and the reply asks for a request", async () => {
    const h = harness({ isEligible: mock(async () => false) });
    await tagged(h);
    expect(h.deps.submit).not.toHaveBeenCalled();
    expect(h.lastReply().text).toContain("You can help by requesting a Community Note in the post's menu.");
  });

  test("when the daily limit is full, the note waits for room", async () => {
    const h = harness({ submit: mock(async (): Promise<SubmissionResult> => ({ status: "daily_limit" })) });
    await tagged(h);
    expect(h.lastReply().text).toContain("X's daily limit for AI-written notes is used up right now.");
  });

  test("gets a no-note answer when the research finds nothing to correct", async () => {
    const h = harness({ checkTweet: mock(async () => checkAnswer({ type: "no_correction", reason: "Accurate", searchResults: "Accurate" })) });
    await tagged(h);
    expect(h.deps.models.writeNoNoteReply).toHaveBeenCalledWith("The rendered post", "Accurate");
    expect(h.lastReply().text).toStartWith("The figures check out.");
    expect(h.deps.submit).not.toHaveBeenCalled();
  });

  test("a second tag repeats a no-note answer without new research", async () => {
    const h = harness({ checkTweet: mock(async () => checkAnswer({ type: "no_correction", reason: "Accurate" })) });
    await tagged(h);
    await tagged(h, "dan");
    expect(h.deps.checkTweet).toHaveBeenCalledTimes(1);
    expect(h.replies[1]!.text).toBe(h.replies[0]!.text);
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
  const waitingHarness = () => harness({ isEligible: mock(async () => false) });

  test("anything else gets no reply", async () => {
    const h = waitingHarness();
    const note = await tagged(h);
    await h.bot.receive(h.post("raj", "lol", note));
    expect(h.replies).toHaveLength(1);
  });

  test("feedback on a waiting note gets a revised note with the revision's reply above it", async () => {
    const h = waitingHarness();
    const note = await tagged(h);
    h.kinds.push("feedback");
    h.revisions.push({ action: "revise", reply: "Good point, here is an official source.", note: BETTER });
    await h.bot.receive(h.post("mohan", "use an official source", note));
    expect(h.deps.models.revise).toHaveBeenCalledWith(expect.objectContaining({
      current: { kind: "note", ...NOTE },
      thread: [expect.objectContaining({ handle: "priya" }), expect.objectContaining({ handle: "CommonNotesBot" }), { handle: "mohan", text: "use an official source" }],
    }));
    expect(h.lastReply().text).toStartWith("Good point, here is an official source.\n\nI wrote this Community Note:");
  });

  test("a revised note goes in right away when X allows it", async () => {
    const isEligible = mock(async () => false);
    const h = harness({ isEligible });
    const note = await tagged(h);
    isEligible.mockImplementation(async () => true);
    h.kinds.push("feedback");
    h.revisions.push({ action: "revise", reply: "Swapped the source.", note: BETTER });
    await h.bot.receive(h.post("mohan", "use an official source", note));
    expect(h.deps.submit).toHaveBeenCalledWith(expect.anything(), BETTER);
    const answers = new Map(h.replies.map((r) => [r.parent, r.text]));
    expect(h.replies.find((r) => r.text.startsWith("Swapped the source."))!.text).toContain("I submitted this Community Note:");
    expect(answers.get(note)).toContain("A newer version of this note was submitted instead");
  });

  test("feedback after the note went in gets the note's link", async () => {
    const h = harness();
    const note = await tagged(h);
    h.store.notes.set(TARGET, "note-1");
    h.kinds.push("feedback");
    await h.bot.receive(h.post("mohan", "wrong source", note));
    expect(h.deps.models.revise).not.toHaveBeenCalled();
    expect(h.lastReply().text).toStartWith("A note from me is already submitted on this post, so I can't change it anymore");
  });

  test("a withdrawal stops a waiting note from being tried", async () => {
    const h = waitingHarness();
    const note = await tagged(h);
    h.kinds.push("feedback");
    h.revisions.push({ action: "withdraw", reply: "You're right, the post is accurate." });
    await h.bot.receive(h.post("dan", "this is accurate", note));
    (h.deps.isEligible as ReturnType<typeof mock>).mockImplementation(async () => true);
    await h.bot.tick();
    expect(h.deps.submit).not.toHaveBeenCalled();
  });
});

describe("waiting notes", () => {
  test("a waiting note goes in once X allows it, with a reply under the note", async () => {
    const isEligible = mock(async () => false);
    const h = harness({ isEligible });
    const note = await tagged(h);
    isEligible.mockImplementation(async () => true);
    await h.bot.tick();
    expect(h.lastReply()).toMatchObject({ parent: note, text: expect.stringMatching(/^Submitted\./) });
    await h.bot.tick();
    expect(h.deps.submit).toHaveBeenCalledTimes(1);
  });

  test("a note that still waits after three hours gets the gave-up reply once", async () => {
    const h = harness({ submit: mock(async (): Promise<SubmissionResult> => ({ status: "daily_limit" })) });
    const note = await tagged(h);
    h.advance(MAX_WAIT_MS + 60_000);
    await h.bot.tick();
    expect(h.lastReply()).toMatchObject({ parent: note, text: expect.stringMatching(/^I couldn't submit this note within 3 hours, because X's daily limit/) });
    const count = h.replies.length;
    await h.bot.tick();
    expect(h.replies).toHaveLength(count);
  });

  test("of two waiting versions, the newest goes in and the older one gets its link", async () => {
    const isEligible = mock(async () => false);
    const h = harness({ isEligible });
    const first = await tagged(h);
    h.kinds.push("feedback");
    h.revisions.push({ action: "revise", reply: "Here is a better source.", note: BETTER });
    await h.bot.receive(h.post("mohan", "better source please", first));
    const second = h.lastReply().id;

    isEligible.mockImplementation(async () => true);
    await h.bot.tick();
    expect(h.deps.submit).toHaveBeenLastCalledWith(expect.anything(), BETTER);
    const answers = new Map(h.replies.map((r) => [r.parent, r.text]));
    expect(answers.get(second)).toStartWith("Submitted.");
    expect(answers.get(first)).toContain(`https://x.com/i/status/${second}`);
  });
});

test("leading mentions are stripped from the tagger's comment", () => {
  expect(withoutLeadingMentions("@CommonNotesBot @dan is this true?")).toBe("is this true?");
  expect(withoutLeadingMentions("is this true @CommonNotesBot")).toBe("is this true @CommonNotesBot");
});
