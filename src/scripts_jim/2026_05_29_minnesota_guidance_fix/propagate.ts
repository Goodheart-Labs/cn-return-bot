/**
 * Surgical fix: the Minnesota voucher-law row (tweet 2004909604052889910) had
 * over-strict judge_guidance — it required the note to AFFIRM the post's *true*
 * premise (vouching lets a voter vouch for 8 others) as a mandatory pass
 * condition, on top of correcting the actual misleading claim ("No ID
 * required"). A correct community note rebuts what's false; it needn't restate
 * the true part. This relaxes req (1) to optional context and keeps req (2) as
 * the bar. Provably-over-strict fix, sanctioned by the anti-goodhart rule.
 *
 * Replaces the exact guidance substring in the annotation source + every
 * derived file the eval reads, without re-running 08_assemble (which would
 * clobber the sealed test split and in-progress val_remaining work).
 */
import * as fs from "fs";

const OLD =
  "PASS only if the note (1) confirms vouching is real and lets a registered voter vouch for up to eight others, AND (2) explicitly corrects the tweet's 'No ID required' claim — the registrant must still provide a MN ID/driver's-license number or last 4 of SSN for identity verification; vouching substitutes only for proof of residency. FAIL notes that just restate the law without addressing the 'no ID' misframing.";

const NEW =
  "PASS if the note corrects the tweet's 'No ID required' claim — the registrant must still provide a MN ID/driver's-license number or last 4 of SSN for identity verification; vouching substitutes only for proof of residency. The note need not restate the (true) detail that one voter may vouch for up to eight others, though doing so adds context. FAIL notes that just restate the law without addressing the 'no ID' misframing.";

const files = [
  "datasets/big_eval/annotations/2004909604052889910.json",
  "datasets/big_eval/dataset.jsonl",
  "datasets/big_eval/splits/val.jsonl",
  "datasets/big_eval/splits/val.csv",
];

for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  const count = text.split(OLD).length - 1;
  if (count === 0) {
    console.log(`SKIP (no match): ${f}`);
    continue;
  }
  fs.writeFileSync(f, text.split(OLD).join(NEW), "utf8");
  console.log(`patched ${count}x: ${f}`);
}
