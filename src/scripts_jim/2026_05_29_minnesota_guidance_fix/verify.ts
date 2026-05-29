/** Confirm the Minnesota guidance relaxation flips the eval verdict. Runs the
 *  eval judge K times on the SAME published note under OLD vs NEW guidance. */
import "dotenv/config";
import { judgeRow } from "../../local/evaluateResults";

const K = 5;

const NOTE =
  "Vouching in Minnesota only substitutes for a proof-of-residence document. The voter being vouched for must still provide their Minnesota driver's license/ID number or last four SSN for identity verification. https://www.sos.mn.gov/elections-voting/secure-and-fair-elections/minnesota-election-facts/";
const TWEET =
  "Minnesota Voter Fraud — Did you know that a registered voter in MN can vouch for up to EIGHT other voters in their precinct? No ID required. No proof of residency. 1 voter can vouch for 8 others. Yes, this is the law & it's directly on the MN SOS website";
const GROUND_TRUTH =
  "Minnesota law (Minn. Stat. 201.061) lets a registered precinct voter vouch for up to eight others, but ONLY as proof of residency. The voter still must supply a MN ID/driver's license number or last 4 of SSN for identity verification, and the voucher signs an oath under penalty of perjury. Vouching has existed for 50+ years.";

const OLD =
  "PASS only if the note (1) confirms vouching is real and lets a registered voter vouch for up to eight others, AND (2) explicitly corrects the tweet's 'No ID required' claim — the registrant must still provide a MN ID/driver's-license number or last 4 of SSN for identity verification; vouching substitutes only for proof of residency. FAIL notes that just restate the law without addressing the 'no ID' misframing. Bonus: note that the law is 50+ years old, and that the voucher signs an oath under penalty of perjury.";
const NEW =
  "PASS if the note corrects the tweet's 'No ID required' claim — the registrant must still provide a MN ID/driver's-license number or last 4 of SSN for identity verification; vouching substitutes only for proof of residency. The note need not restate the (true) detail that one voter may vouch for up to eight others, though doing so adds context. FAIL notes that just restate the law without addressing the 'no ID' misframing. Bonus: note that the law is 50+ years old, and that the voucher signs an oath under penalty of perjury.";

async function rate(guidance: string): Promise<number> {
  const row = {
    text: TWEET,
    ground_truth_note: GROUND_TRUTH,
    judge_guidance: guidance,
    note_text: NOTE,
    needs_note: "yes",
  };
  const results = await Promise.all(Array.from({ length: K }, () => judgeRow(row)));
  return results.filter((r) => r.tier !== "bad").length;
}

const [oldPass, newPass] = await Promise.all([rate(OLD), rate(NEW)]);
console.log(`OLD guidance: ${oldPass}/${K} PASS`);
console.log(`NEW guidance: ${newPass}/${K} PASS`);
