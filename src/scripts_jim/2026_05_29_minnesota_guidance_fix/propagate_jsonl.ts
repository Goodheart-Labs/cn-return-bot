/**
 * Second pass: patch the two JSONL masters (dataset.jsonl, val.jsonl) whose
 * em-dash byte differs from val.csv, so the full-string replace skipped them.
 * Dash-agnostic two-step replace — splits around the em-dash so we never need
 * to match it, and preserves each file's own dash byte. Result is byte-identical
 * to the guidance already applied to the annotation + val.csv.
 */
import * as fs from "fs";

const FRONT_OLD =
  "PASS only if the note (1) confirms vouching is real and lets a registered voter vouch for up to eight others, AND (2) explicitly corrects the tweet's 'No ID required' claim";
const FRONT_NEW = "PASS if the note corrects the tweet's 'No ID required' claim";

const TAIL_OLD = "vouching substitutes only for proof of residency. FAIL notes";
const TAIL_NEW =
  "vouching substitutes only for proof of residency. The note need not restate the (true) detail that one voter may vouch for up to eight others, though doing so adds context. FAIL notes";

for (const f of ["datasets/big_eval/dataset.jsonl", "datasets/big_eval/splits/val.jsonl"]) {
  let text = fs.readFileSync(f, "utf8");
  const fc = text.split(FRONT_OLD).length - 1;
  const tc = text.split(TAIL_OLD).length - 1;
  if (fc !== 1 || tc !== 1) {
    console.log(`SKIP ${f} — front=${fc} tail=${tc} (expected 1/1)`);
    continue;
  }
  text = text.split(FRONT_OLD).join(FRONT_NEW).split(TAIL_OLD).join(TAIL_NEW);
  fs.writeFileSync(f, text, "utf8");
  console.log(`patched ${f}`);
}
