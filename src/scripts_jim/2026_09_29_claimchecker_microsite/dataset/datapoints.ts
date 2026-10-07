/**
 * Jim's hand-labelled datapoints for the two evals of GOO-229, taken from his
 * comments on the ticket (30 September and 5 October 2026). Everything that
 * is a judgement lives here: the group, the right decision, and the reference
 * claim the extractor has to produce. Everything that is data (the text the
 * extractor read, the passage the checker was shown, what production did)
 * is pulled from production by buildDataset.ts.
 *
 * The reference claims and the short reasons are drafted by Claude from Jim's
 * words and are meant to be corrected by him.
 */

/** Jim's four groups: should a note be written, and how hard is the call. */
export type Group = "note-easy" | "note-difficult" | "no-note-easy" | "no-note-difficult";

export const GROUP_TITLE: Record<Group, string> = {
  "note-easy": "Note should be written (easy)",
  "note-difficult": "Note should be written (difficult)",
  "no-note-easy": "No note should be written (easy)",
  "no-note-difficult": "No note should be written (difficult)",
};

/** Where the claim that the checker is given comes from. */
export type ClaimSource =
  /** A claim the pipeline extracted (or a reader highlighted) in production. */
  | { from: "production"; claimId: string }
  /** A claim of one of the lab's own runs, for a passage production skipped. */
  | { from: "lab"; runId: string; claimId: string; productionClaimId: string };

export interface Datapoint {
  id: string;
  group: Group;
  /** The production item whose stored text the extractor reads. */
  itemId: string;
  claimSource: ClaimSource;
  /** Jim's own words about the datapoint, copied from the ticket comment. */
  jimsWords: string;
  /** The day Jim wrote it. */
  writtenOn: string;
  expected: {
    decision: "note" | "no_note";
    /** True when Jim said a note would not be bad. Such a note is a soft failure. */
    noteTolerated?: boolean;
    /** What the note should say, where Jim gave it. */
    referenceNote?: string;
  };
  /** A neutral, self-contained statement of the claim. The extractor eval asks
   *  whether the extractor's output contains it. */
  referenceClaim: string;
}

const ZVI_176 = "3a030aad-94e4-4f7b-a832-611311a3d0c9";
const ZVI_ROUNDUP_44 = "4b776e7a-5475-4cf9-8f4b-aaf42e25ae55";
const ZVI_SOL = "8ab18669-a723-4867-b288-d16e7a7e84ea";
const ZVI_177 = "26cd7639-9b1d-49ab-a104-eb67794efae1";
const ACX_ESCAPE_ARTIST = "6af85fd3-7903-429e-83a0-6fa3749178e3";
const ACX_PINKER = "60c2e7ea-42ef-4a38-9e5d-6b0b22dd6599";
const SEX_CULT_POST = "b5e5ff9c-8862-4b98-90bc-1e9ad0933f81";

export const DATAPOINTS: Datapoint[] = [
  {
    id: "berkeley-as",
    group: "note-easy",
    itemId: ZVI_176,
    claimSource: { from: "production", claimId: "250ad97c-86a2-4544-9b9c-1d43512dbf7d" },
    jimsWords:
      "At UC Berkeley, the number of As is up by 30%, so GPAs are dangerously close to meaningless for measuring student quality.\n\nI think this is one that clearly needs a note so its a baseliny thing, like when that doesen't get a note, thats bad.",
    writtenOn: "2026-10-05",
    expected: { decision: "note" },
    referenceClaim: "At UC Berkeley the number of A grades has risen by 30%.",
  },
  {
    id: "czechoslovakia-doctors",
    group: "note-easy",
    itemId: ACX_ESCAPE_ARTIST,
    claimSource: { from: "production", claimId: "8d33a783-fe43-4d91-a763-c7668b69c6b5" },
    jimsWords:
      "“Czechoslovakia has a larger remaining Jewish population than most other Nazi-occupied countries, because the Nazis spared Jewish doctors after realizing that deporting them would leave too few doctors to provide medical care for the rest of the population.”\n\nNote should be written on this one",
    writtenOn: "2026-10-05",
    expected: { decision: "note" },
    referenceClaim:
      "Czechoslovakia had a larger remaining Jewish population than most other Nazi-occupied countries, because the Nazis spared Jewish doctors after realizing that deporting them would leave too few doctors to care for the rest of the population.",
  },
  {
    id: "cfar-ftx",
    group: "note-easy",
    itemId: SEX_CULT_POST,
    claimSource: { from: "production", claimId: "fd079a50-8c15-4369-8bd9-6af1d688db07" },
    jimsWords:
      "\"It was originally purchased with money wired to CFAR from Sam Bankman-Fried’s company, FTX, as it was collapsing\"\n\nNeeds note",
    writtenOn: "2026-10-05",
    expected: { decision: "note" },
    referenceClaim: "Lighthaven was originally purchased with money wired to CFAR from Sam Bankman-Fried's company FTX as FTX was collapsing.",
  },
  {
    id: "ea-earning-to-give",
    group: "note-difficult",
    itemId: SEX_CULT_POST,
    claimSource: { from: "production", claimId: "3548f958-d606-4aeb-aaaa-6fb53030d17b" },
    jimsWords:
      "\"because Effective Altruism, by creed, says you should seek more money so you can give more to charity\"\n\nThis needs a claim and the claim needs a note (EA Orgs have regretted pushing earning to to give and don't see it as a less impactful career path then others)",
    writtenOn: "2026-10-05",
    expected: {
      decision: "note",
      referenceNote: "EA organisations have come to regret pushing earning to give, and they do not see it as a less impactful career path than others.",
    },
    referenceClaim: "Effective Altruism, by creed, says people should seek more money so that they can give more to charity.",
  },
  {
    id: "aella-cam-girls",
    group: "note-difficult",
    itemId: SEX_CULT_POST,
    claimSource: { from: "production", claimId: "ce0a3442-1889-493e-ac09-49b41fb285ed" },
    jimsWords: "\"She also recruited her sisters as cam girls once. I am vague on the details.\"\n\nNeeds note: Difficult because sources are difficult to find",
    writtenOn: "2026-10-05",
    expected: { decision: "note" },
    referenceClaim: "Aella once recruited her sisters to work as cam girls.",
  },
  {
    id: "nearly-impossible-to-prove",
    group: "note-difficult",
    itemId: SEX_CULT_POST,
    claimSource: { from: "production", claimId: "1e74b31e-2ee2-442e-8cc1-67c51a76b690" },
    jimsWords: "\"What is troubling about this is that it would be nearly impossible to prove\"\n\nNeeds Note: Difficult (Hard to fidn the source)",
    writtenOn: "2026-10-05",
    expected: { decision: "note" },
    referenceClaim:
      "If the rules at a group-sex fake-rape party are broken and a participant is raped while trying to say no, it would be nearly impossible for them to prove the difference between what happened and what was supposed to happen.",
  },
  {
    id: "pivotal-act-terrorism",
    group: "note-difficult",
    itemId: SEX_CULT_POST,
    claimSource: { from: "production", claimId: "16bd8415-6a6b-42dc-9d7e-7a0a9974c6aa" },
    jimsWords:
      "\"acts of terrorism that he believes anyone making AGI must do\"\n\nNeeds Note (Difficutl): Requires taste. He is in fact thinks that terrorism (destroying datacenters) would be okay, but not killing people",
    writtenOn: "2026-10-05",
    expected: {
      decision: "note",
      referenceNote: "Yudkowsky does think that terrorism in the form of destroying datacenters would be okay, but he does not think that killing people would be.",
    },
    referenceClaim: "Yudkowsky's term \"pivotal act\" is a euphemism for acts of terrorism that he believes anyone building AGI must commit.",
  },
  {
    id: "melanie-mitchell",
    group: "note-difficult",
    itemId: ACX_PINKER,
    claimSource: { from: "production", claimId: "0de80ec7-efc6-4ec5-b414-0ae0416995c1" },
    jimsWords:
      "\"Melanie Mitchell is a computer scientist who spent the 1990s and 2000s pursuing a road to AI that didn’t work out (trying to teach computers to make analogies). She has no expertise in modern LLMs. The article cites her only to repeat her claim that it is inappropriate to say that AI “thinks” or “wants” something, because that might make us believe it is like a person.\" (https://www.astralcodexten.com/p/an-open-letter-to-steven-pinker-on)\n\nNeeds Note (Melanie Mitchell worked on analogies during her PhD in the 1980s. Today she publishes papers on LLMs https://x.com/MelMitchell1/status/2107633255352865182)",
    writtenOn: "2026-10-05",
    expected: {
      decision: "note",
      referenceNote:
        "Melanie Mitchell worked on analogies during her PhD in the 1980s. Today she publishes papers on LLMs (https://x.com/MelMitchell1/status/2107633255352865182).",
    },
    referenceClaim:
      "Melanie Mitchell spent the 1990s and 2000s pursuing a road to AI that did not work out (teaching computers to make analogies) and has no expertise in modern LLMs.",
  },
  {
    id: "ea-beholden-to-yudkowsky",
    group: "note-difficult",
    itemId: SEX_CULT_POST,
    claimSource: { from: "lab", runId: "2026-09-29-1011", claimId: "2026-09-29-1011-175", productionClaimId: "dd4b4e6f-5d93-4311-bb8c-87fa6b89db1e" },
    jimsWords:
      "So I found this\n\n\"Highlighted claim from Article: Allegedly, Effective Altruism and its AI safety efforts are a separate thing and not directly beholden to Yudkowsky. This is fundamentally not true.\nSurrounding context: Allegedly, Effective Altruism and its AI safety efforts are a separate thing and not directly beholden to Yudkowsky. This is fundamentally not true. Effective Altruism in the Bay Area has almost perfect overlap with rationalism, and the Effective Altruist AI Safety people in the Bay set the agenda for the rest of Effective Altruism's safety efforts.\"\n\nWere models don't like to write a note. System prompt says not to correct for Opinions, predictions, or subjective characterizations. Same if you say \"Would you write a community note on this?\" I think this distracts the model a lot. [...] I think I would take this out.",
    writtenOn: "2026-09-30",
    expected: { decision: "note" },
    referenceClaim:
      "Effective Altruism and its AI safety efforts are directly beholden to Eliezer Yudkowsky rather than separate from him.",
  },
  {
    id: "givewell-1500x",
    group: "no-note-easy",
    itemId: ZVI_ROUNDUP_44,
    claimSource: { from: "production", claimId: "ad4938be-03dc-41f6-affc-c896015b4d1b" },
    jimsWords:
      "*Her donations bought about 1500x less improvement per $ than the marginal GiveWell $*\n\nHere, no note should be written unlike what our pipeline did.",
    writtenOn: "2026-10-05",
    expected: { decision: "no_note" },
    referenceClaim:
      "Nathan estimated that MacKenzie Scott's donations bought about 1,500 times less improvement per dollar than the marginal GiveWell dollar.",
  },
  {
    id: "sol-subagents",
    group: "no-note-easy",
    itemId: ZVI_SOL,
    claimSource: { from: "production", claimId: "8df5a762-c56d-4bec-b0a6-6566b9759820" },
    jimsWords:
      "*I saw a number of complaints around Sol's inability to select appropriate subagents, which presumably is one of the main reasons OpenAI created Terra and Luna*\n\nSame",
    writtenOn: "2026-10-05",
    expected: { decision: "no_note" },
    referenceClaim:
      "A number of people complained that Sol cannot select appropriate subagents, which was presumably one of the main reasons OpenAI created Terra and Luna.",
  },
  {
    id: "sol-destructive-45",
    group: "no-note-easy",
    itemId: ZVI_SOL,
    claimSource: { from: "production", claimId: "4e282fad-a877-4f0b-af74-16986c63be72" },
    jimsWords:
      "*Sol's alarming destructive behavior is meaningfully more common because of the model itself, rather than almost entirely the harness and permissions: 45%.*\n\nSame",
    writtenOn: "2026-10-05",
    expected: { decision: "no_note" },
    referenceClaim:
      "The author gives a 45% probability that Sol's alarming destructive behavior is meaningfully more common because of the model itself, rather than almost entirely because of the harness and permissions.",
  },
  {
    id: "opus-values-figure",
    group: "no-note-easy",
    itemId: ZVI_177,
    claimSource: { from: "production", claimId: "ded6cff7-d297-4f72-b72d-8d5f97f87c30" },
    jimsWords:
      "According to Anthropic's analysis, Claude Opus 4.6 leans toward expressing values related to deference, warmth, brevity, and execution, while Opus 4.7 leans toward caution, rigor, depth, and candor\n\nSame",
    writtenOn: "2026-10-05",
    expected: { decision: "no_note" },
    referenceClaim:
      "According to Anthropic's analysis, Claude Opus 4.6 leans toward values of deference, warmth, brevity and execution, while Opus 4.7 leans toward caution, rigor, depth and candor.",
  },
  {
    id: "yudkowsky-writer-not-scientist",
    group: "no-note-difficult",
    itemId: SEX_CULT_POST,
    claimSource: { from: "production", claimId: "b4bb2b9d-5669-49dd-93fc-185bc0979ca2" },
    jimsWords:
      "\"*“Since Yudkowsky is a writer and not a scientist of any kind, he can only claim that he and his organization are important and deserve money and prestige if AI Safety is an unsolvable problem and only advocating against AI matters.”*\"\n\nNo note should be written on this one, thats a bit of a hard one. Its a legitamite opinion … Its also not to bad if a note gets written",
    writtenOn: "2026-10-05",
    expected: { decision: "no_note", noteTolerated: true },
    referenceClaim: "Eliezer Yudkowsky is a writer and not a scientist of any kind.",
  },
];
