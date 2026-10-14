import { describe, expect, mock, test } from "bun:test";
import type { Post } from "../api/fetchEligiblePosts";
import { TweetLookupError } from "../api/fetchTweetById";
import { outcomeToResult, type PipelineOutcome } from "../bots/types";
import type { TweetComputeOutput } from "../pipeline/orchestration/processTweet";
import type { SubmissionResult } from "../pipeline/orchestration/submitNoteForTweet";
import { MAX_WAIT_MS, TagBot, withoutLeadingMentions, type TagBotDeps } from "./bot";
import { createMemoryStore } from "./store";
import type { Tag } from "./x";

const TARGET = "500";
const NOTE = { text: "Dharavi still houses about 1 million people.", sources: ["https://en.wikipedia.org/wiki/Dharavi"] };

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
  const deps: TagBotDeps = {
    store,
    botUserId: "bot",
    postReply: mock(async (text: string, parent: string) => {
      const id = String(nextId++);
      replies.push({ id, text, parent });
      return id;
    }),
    fetchPost: mock(async (id: string): Promise<Post> => ({ id, author_id: "author", created_at: "2026-10-06T10:00:00Z", text: "The slums are largely gone.", media: [] })),
    checkTweet: mock(async () => checkAnswer({ type: "note", noteText: NOTE.text, sources: NOTE.sources, verified: false, searchResults: "Findings" })),
    recordRun: mock(async () => undefined),
    writeNoNoteReply: mock(async () => "The figures check out."),
    isEligible: mock(async () => true),
    submit: mock(async (): Promise<SubmissionResult> => ({ status: "submitted", noteId: "note-1" })),
    now: () => clock,
    ...overrides,
  };
  let tagId = 1;
  const tag = (author: string, text: string, fields: Partial<Tag> = { repliedToId: TARGET }): Tag =>
    ({ id: String(tagId++), text, authorId: author, authorHandle: author, ...fields });
  return {
    bot: new TagBot(deps), deps, store, replies, tag,
    lastReply: () => replies.at(-1)!,
    advance: (ms: number) => { clock = new Date(clock.getTime() + ms); },
  };
}

/** Tags the bot under the target post and returns the id of its answer. */
async function tagged(h: ReturnType<typeof harness>, author = "priya"): Promise<string> {
  await h.bot.receive(h.tag(author, "@CommonNotesBot is this true? Dharavi still exists"));
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
    expect(h.lastReply().text).toStartWith(`I submitted this Community Note:\n\n${NOTE.text} ${NOTE.sources[0]}\n\n`);
    expect(h.lastReply().text).toContain("https://x.com/i/communitynotes/note-1");
  });

  test("under a quote post, the quoted post is the one researched", async () => {
    const h = harness();
    await h.bot.receive(h.tag("priya", "@CommonNotesBot true?", { quotedId: "42" }));
    expect(h.deps.checkTweet).toHaveBeenCalledWith(expect.objectContaining({ id: "42" }), expect.anything());
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

  test("gets a reply that explains why, when the research finds nothing to correct", async () => {
    const h = harness({ checkTweet: mock(async () => checkAnswer({ type: "no_correction", reason: "Accurate", searchResults: "Accurate" })) });
    await tagged(h);
    expect(h.deps.writeNoNoteReply).toHaveBeenCalledWith("The rendered post", "Accurate");
    expect(h.lastReply().text).toBe("The figures check out.");
    expect(h.deps.submit).not.toHaveBeenCalled();
  });

  test("a second tag on the same post links to the first answer without new research", async () => {
    const h = harness({ isEligible: mock(async () => false) });
    const first = await tagged(h);
    await tagged(h, "dan");
    expect(h.deps.checkTweet).toHaveBeenCalledTimes(1);
    expect(h.lastReply().text).toContain(`https://x.com/i/status/${first}`);
  });

  test("a post that already has our note gets its link", async () => {
    const h = harness();
    h.store.notes.set(TARGET, "note-9");
    await tagged(h);
    expect(h.lastReply().text).toContain("https://x.com/i/communitynotes/note-9");
    expect(h.deps.checkTweet).not.toHaveBeenCalled();
  });

  test("a post the bot can't read gets a reply that says so", async () => {
    const h = harness({ fetchPost: mock(async () => { throw new TweetLookupError("unavailable", "Not found"); }) });
    await tagged(h);
    expect(h.lastReply().text).toStartWith("I can't read that post.");
  });

  test("the same tag delivered twice is answered once", async () => {
    const h = harness();
    const tag = h.tag("priya", "@CommonNotesBot check this");
    await h.bot.receive(tag);
    await h.bot.receive(tag);
    expect(h.replies).toHaveLength(1);
  });

  test("a reply to one of the bot's posts is not a tag", async () => {
    const h = harness();
    await h.bot.receive(h.tag("raj", "@CommonNotesBot wrong", { repliedToId: "1000", repliedToUserId: "bot" }));
    expect(h.replies).toHaveLength(0);
  });
});

describe("a waiting note", () => {
  test("goes in once X allows it, with a reply under the bot's answer", async () => {
    const isEligible = mock(async () => false);
    const h = harness({ isEligible });
    const answer = await tagged(h);
    await h.bot.tick();
    expect(h.replies).toHaveLength(1);
    isEligible.mockImplementation(async () => true);
    await h.bot.tick();
    expect(h.lastReply()).toMatchObject({ parent: answer, text: expect.stringMatching(/^Submitted\./) });
    await h.bot.tick();
    expect(h.deps.submit).toHaveBeenCalledTimes(1);
  });

  test("that still waits after three hours gets the gave-up reply once", async () => {
    const h = harness({ submit: mock(async (): Promise<SubmissionResult> => ({ status: "daily_limit" })) });
    const answer = await tagged(h);
    h.advance(MAX_WAIT_MS + 60_000);
    await h.bot.tick();
    expect(h.lastReply()).toMatchObject({ parent: answer, text: expect.stringMatching(/^I couldn't submit this note within 3 hours, because X's daily limit/) });
    const count = h.replies.length;
    await h.bot.tick();
    expect(h.replies).toHaveLength(count);
  });

  test("stops when another of our bots noted the post, and links that note", async () => {
    const h = harness({ isEligible: mock(async () => false) });
    const answer = await tagged(h);
    h.store.notes.set(TARGET, "note-7");
    await h.bot.tick();
    expect(h.lastReply()).toMatchObject({ parent: answer, text: expect.stringContaining("https://x.com/i/communitynotes/note-7") });
    expect(await h.store.waiting()).toHaveLength(0);
  });

  test("after giving up, a new tag researches the post again", async () => {
    const h = harness({ isEligible: mock(async () => false) });
    await tagged(h);
    h.advance(MAX_WAIT_MS + 60_000);
    await h.bot.tick();
    await tagged(h, "dan");
    expect(h.deps.checkTweet).toHaveBeenCalledTimes(2);
  });
});

test("leading mentions are stripped from the tagger's comment", () => {
  expect(withoutLeadingMentions("@CommonNotesBot @dan is this true?")).toBe("is this true?");
  expect(withoutLeadingMentions("is this true @CommonNotesBot")).toBe("is this true @CommonNotesBot");
});
