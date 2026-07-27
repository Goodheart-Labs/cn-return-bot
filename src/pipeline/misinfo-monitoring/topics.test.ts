import { test, expect } from "bun:test";
import { MISINFO_TOPICS } from "./topics";

// The keyword predicate is applied to a LOWERCASED blob (see keywordFilter's
// blob()), so every fixture here is lowercase.
const matches = MISINFO_TOPICS.find((t) => t.id === "trump_election_security")!.matches;

// Fixtures are synthetic, written to carry the same lexical features as the
// real posts each case was derived from. Each `should match` case represents a
// class of post that the pre-widening predicate provably dropped, measured
// against public Community Notes data; each `should not match` case pins a
// rejection we want to keep.

test("standalone: names the subject with no voting word anywhere", () => {
  // The pairing rule needs an election/voting term. These have none.
  expect(matches("that senator says he doesn't even want the save america act")).toBe(true);
  expect(matches("pass the save act, whatever it takes")).toBe(true);
});

test("standalone: survives a typo in the only voting word present", () => {
  expect(matches("china hacked 220 million vioter files in 2020 and they covered it up")).toBe(true);
});

test("the noncitizen figure as posts actually write it", () => {
  // Old predicate hardcoded 278,000 and hyphenated/closed noncitizen only.
  expect(matches("dhs found 280,000 non citizens registered to vote in four states")).toBe(true);
  expect(matches("over 250 thousand noncitizens registered to vote")).toBe(true);
  expect(matches("a quarter million noncitizens registered to vote")).toBe(true);
});

test("false-victory claims about 2020", () => {
  expect(matches("trump won the 2020 election, period")).toBe(true);
});

test("election-administration vocabulary", () => {
  expect(matches("the doj is sending election monitors to three cities before the primaries")).toBe(true);
  expect(matches("the state processed 163,900 duplicate registrations last cycle")).toBe(true);
  expect(matches("illegals are voting in our elections")).toBe(true);
  expect(matches("if your birth certificate name differs from your license you cannot vote")).toBe(true);
});

// ── 7/24 claim-coverage audit: the speech's coverup-lore specifics ──────────
// (src/scripts_rob/2026_07_24_claim_coverage_audit) These claim families were
// in the address but their posts often carry no voting word, so the pairing
// rule never saw them: ~106 posts / ~11M impressions missed since 7/16.

test("coverup specifics: standalone speech-lore phrases with no voting word", () => {
  expect(matches("an fbi official admitted running a shadow government to bury the intel")).toBe(true);
  expect(matches("obama's burn bags were never incinerated. think about what was in them.")).toBe(true);
  expect(matches("they deliberately massaged the presidential daily brief to hide it")).toBe(true);
});

test("coverup phrasings next to an election word", () => {
  expect(matches("'most secure election in history' was a cover story and they knew it")).toBe(true);
  expect(matches("evidence of election fraud was covered up for years")).toBe(true);
});

test("china influence ops: journalists and business leaders, no voting word", () => {
  expect(matches("cia docs show china paid us journalists to write hit pieces on trump")).toBe(true);
  expect(matches("beijing pressured american business leaders to turn against the president")).toBe(true);
});

test("mail-in without the hyphen, and ballots through the mail", () => {
  expect(matches("mail in ballots are inherently corrupt, always have been")).toBe(true);
  expect(matches("tens of millions of ballots flowing aimlessly through the mail. insanity.")).toBe(true);
});

test("slow-count and compromise stems near an election word", () => {
  expect(matches("more than a month to count the votes in california. worse than a third world country.")).toBe(true);
  expect(matches("these voting systems are easy to compromise and they knew it")).toBe(true);
});

test("china influence ops still needs an ops verb, not china+journalist alone", () => {
  expect(matches("chinese journalists covered the summit from beijing")).toBe(false);
});

test("still matches what it always matched", () => {
  expect(matches("dominion voting machines were compromised in the last election")).toBe(true);
  expect(matches("they rigged the election with mail-in ballots")).toBe(true);
  expect(matches("china bought our voter data before the election")).toBe(true);
});

// ── precision guards ────────────────────────────────────────────────────────
// Stage 2 is the real precision gate, but stage 1 should not spend judge budget
// on entire categories that can never be on topic.

test("foreign elections stay out", () => {
  expect(matches("labour won the makerfield by-election with 24,927 votes")).toBe(false);
  expect(matches("the anti-corruption agency found pre-written election results during a raid")).toBe(false);
});

test("bare commentary about the 2020 election stays out", () => {
  // "2020 election" alone is most of the feed's political talk; only the
  // false-victory form is a claim we can correct.
  expect(matches("trump lost the 2020 election, end of story")).toBe(false);
  expect(matches("the networks should not air his 2020 election conspiracy theories")).toBe(false);
});

test("campaign-finance figures are not the noncitizen figure", () => {
  expect(matches("that pac has spent $288 million this election cycle")).toBe(false);
});

test("immigration talk that merely sits next to a voting word stays out", () => {
  expect(matches("democrats stand with illegals!!! vote red in november")).toBe(false);
  expect(matches("they gave welfare to illegal foreigners and nobody voted for that")).toBe(false);
});
