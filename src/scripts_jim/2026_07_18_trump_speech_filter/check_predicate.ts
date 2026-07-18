// Sanity check for the trump_election_security Stage-1 predicate + topic load.
// Run: bun run src/scripts_jim/2026_07_18_trump_speech_filter/check_predicate.ts
import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";
import { blob } from "../../pipeline/misinfo-monitoring/keywordFilter";

const topic = MISINFO_TOPICS.find((t) => t.id === "trump_election_security")!;
console.log("topic loaded:", topic.title);
console.log("brief (the speech transcript) chars:", topic.brief.length);

const cases: Array<[boolean, string]> = [
  [true, "The 2020 election was STOLEN! China hacked 220 million voter files and Dominion flipped votes."],
  [true, "DHS found 278,000 noncitizens on the voter rolls. Mail-in ballots are inherently corrupt."],
  [true, "China accessed our voter data and the deep state covered it up before the election."],
  [true, "Venezuela's Maduro digitally rigged their election — same voting machines could do it here."],
  [false, "Don't forget to vote today! Polls close at 8pm, bring your ID."],
  [false, "I love pizza and long walks on the beach."],
  [false, "The local school board election had record turnout this year."],
];

let pass = 0;
for (const [expected, text] of cases) {
  const got = topic.matches(blob({ id: "x", text } as any));
  const ok = got === expected;
  if (ok) pass++;
  console.log(`${ok ? "OK  " : "FAIL"} expected=${expected} got=${got} | ${text.slice(0, 60)}`);
}
console.log(`\n${pass}/${cases.length} predicate cases passed`);
process.exit(pass === cases.length ? 0 : 1);
