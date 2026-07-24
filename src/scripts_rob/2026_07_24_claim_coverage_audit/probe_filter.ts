/**
 * Claim-coverage audit of the trump_election_security keyword filter.
 *
 * Nathan's question (Slack, 7/24): "can you check the address a bit and see
 * what topics it could be on ... are the searches getting most of it?"
 *
 * Method: enumerate every claim area in the speech transcript
 * (briefs/trump_election_security.md — the Stage-2 brief IS the verbatim
 * transcript), write realistic post paraphrases for each — including
 * deliberately keyword-poor phrasings — and run them through the real
 * Stage-1 predicate. Stage 2 judges against the full transcript, so any
 * claim that reaches it is handled; recall gaps live entirely in Stage 1.
 *
 * Run: bun src/scripts_rob/2026_07_24_claim_coverage_audit/probe_filter.ts
 */

import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";

const topic = MISINFO_TOPICS.find((t) => t.id === "trump_election_security");
if (!topic) throw new Error("topic not found");

interface Probe {
  area: string;
  text: string;
  /** hard = a phrasing we'd LIKE to catch but suspect the regex misses */
  hard?: boolean;
}

const PROBES: Probe[] = [
  // A — China acquired 220M voter files
  { area: "A 220M files", text: "China stole 220 million American voter files and nobody went to jail" },
  { area: "A 220M files", text: "The CCP has the personal data of two hundred twenty million Americans who vote", hard: true },
  { area: "A 220M files", text: "Beijing has a dedicated data exploitation unit working through our records", hard: true },
  { area: "A 220M files", text: "the largest compromise of election data in history and the media ignores it" },

  // B — Deep state / IC coverup specifics
  { area: "B coverup", text: "The deep state hid China's election meddling from the president for years" },
  { area: "B coverup", text: "An FBI official literally admitted running a shadow government to bury the intel", hard: true },
  { area: "B coverup", text: "They deliberately massaged the presidential daily briefing to hide what China was doing", hard: true },
  { area: "B coverup", text: "Obama's burn bags were never incinerated. Think about what was in them.", hard: true },
  { area: "B coverup", text: "'Most secure election in history' was a cover story and they knew it" },

  // C — China 2018-19 influence ops (journalists, business leaders)
  { area: "C influence ops", text: "CIA docs show China paid US journalists to write hit pieces on Trump", hard: true },
  { area: "C influence ops", text: "Beijing pressured American CEOs to turn against the president in 2019", hard: true },
  { area: "C influence ops", text: "China spent millions influencing the 2020 election because of the tariffs" },

  // D — China manufactured illegal ballots for Biden
  { area: "D fake ballots", text: "The FBI knew China tried to manufacture illegal ballots for Biden in 2020" },
  { area: "D fake ballots", text: "Fake Chinese ballots. It was real. The FBI buried it.", hard: true },

  // E — Machines vulnerable / Venezuela-Maduro
  { area: "E machines", text: "Our voting machines are easily compromised and the government knew all along" },
  { area: "E machines", text: "The CIA had proof Maduro digitally rigged Venezuela's election with no audit trail" },
  { area: "E machines", text: "Dominion and Smartmatic have questions to answer after tonight" },
  { area: "E machines", text: "If they could do a big number for Maduro they can do it here", hard: true },

  // F — Michigan / Muskegon registration fraud
  { area: "F Michigan", text: "Michigan State Police raided a Democrat voter registration operation and the DOJ killed the case" },
  { area: "F Michigan", text: "Canvassers in Muskegon got gift cards for fake registrations. FBI knew. Biden DOJ buried it.", hard: true },
  { area: "F Michigan", text: "The Muskegon raid files are out. Read them.", hard: true },

  // G — 278,000 noncitizens / dead voters
  { area: "G noncitizens", text: "DHS found 278,000 noncitizens registered to vote" },
  { area: "G noncitizens", text: "278.000 illegals on the rolls and Democrat states are hiding more", hard: true },
  { area: "G noncitizens", text: "over 250 thousand foreigners registered to vote in federal elections" },
  { area: "G noncitizens", text: "A quarter of a million foreigners are on our voter rolls" },
  { area: "G noncitizens", text: "Dead voters are still active on the rolls in every state" },

  // H — Mail-in ballots inherently corrupt
  { area: "H mail-in", text: "Mail-in ballots are inherently corrupt, always have been" },
  { area: "H mail-in", text: "Tens of millions of ballots flowing aimlessly through the mail. Insanity." },

  // I — SAVE America Act
  { area: "I SAVE Act", text: "Call your rep and demand they pass the SAVE America Act" },
  { area: "I SAVE Act", text: "The Save Act ends the cheating. That's why they hate it." },
  { area: "I SAVE Act", text: "Photo ID and proof of citizenship to vote. Why would anyone oppose that?" },

  // J — California month-long count
  { area: "J CA count", text: "California took from June 2nd to July 10th to count the votes. Worse than a third world country.", hard: true },
  { area: "J CA count", text: "38 days to count an election in LA. Nothing suspicious there.", hard: true },

  // K — NBC/ABC blackout / media plot
  { area: "K media plot", text: "NBC and ABC refused to air the president's address. They're part of the plot. Revoke the licenses.", hard: true },
  { area: "K media plot", text: "The networks blacked out the speech because they're protecting election fraud" },
];

let hits = 0;
let misses = 0;
const missRows: string[] = [];
for (const p of PROBES) {
  const matched = topic.matches(p.text.toLowerCase());
  if (matched) hits++;
  else {
    misses++;
    missRows.push(`  [${p.area}]${p.hard ? " (hard)" : " (EXPECTED HIT)"} ${p.text}`);
  }
  console.log(`${matched ? "HIT " : "MISS"}  [${p.area}]${p.hard ? " hard" : ""}  ${p.text}`);
}
console.log(`\n${hits}/${PROBES.length} matched, ${misses} missed`);
if (missRows.length) console.log(`\nMisses:\n${missRows.join("\n")}`);
