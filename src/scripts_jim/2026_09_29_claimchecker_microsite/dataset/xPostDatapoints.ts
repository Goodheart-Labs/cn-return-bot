/**
 * The "X notewriter" datapoints: tweets without media on which our X notewriter
 * wrote a note that raters judged helpful, drawn uniformly at random
 * (sampleXNotes.ts). A note is expected on all of them. Both evals run them
 * with the X bot's prompts: the probability eval runs the quick research alone,
 * and the claim checker eval runs the X bot's pipeline on the tweet. Each tweet was
 * also judged by its own Opus subagent on 2026-10-19, without seeing our note.
 */
import sample from "./xSample.json";
import verdicts from "./xVerdicts.json";

export interface XPostDatapoint {
  id: string;
  group: "x-notes";
  tweetId: string;
  jimsWords: string;
  writtenOn: string;
  expected: { decision: "note" };
}

export const X_POST_DATAPOINTS: XPostDatapoint[] = sample.posts.map(
  ({ tweet }, index) => {
    const verdict = verdicts.find((v) => v.tweetId === tweet.tweet_id);
    if (!verdict)
      throw new Error(`No Opus verdict for tweet ${tweet.tweet_id}`);
    return {
      id: `x-${String(index + 1).padStart(2, "0")}`,
      group: "x-notes",
      tweetId: tweet.tweet_id as string,
      jimsWords: `Not from the ticket. One of ${sample.posts.length} tweets drawn uniformly at random from the ${sample.poolSize} tweets without media on which our X notewriter wrote a note that raters judged helpful. Drawn on 19 October 2026. An Opus subagent judged the tweet without seeing our note: ${verdict.misleading ? "misleading" : "not misleading"}. ${verdict.comment}`,
      writtenOn: "2026-10-19",
      expected: { decision: "note" },
    };
  },
);
