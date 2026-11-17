import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { passagesOverlap } from "./passageRequests";

/* The database has its own copy of passagesOverlap (everything_passages_overlap,
 * migration 168), because notewriter_finish answers readers' passage requests
 * and notewriter_add_note checks for a person's note on the same passage. The
 * migration's verify file checks the database against the cases below it
 * lists. This test checks those same cases against the TypeScript function,
 * so a change to one fails until the other agrees. */

const VERIFY_FILE = join(import.meta.dir, "../../migrations/168_notewriter_protocol.verify.sql");

function verifiedCases(): [string, string, boolean][] {
  const sql = readFileSync(VERIFY_FILE, "utf8");
  const block = sql.slice(sql.indexOf("'passages_overlap_cases'"), sql.indexOf(") as t(a, b, expected)"));
  return [...block.matchAll(/\('([^']*)', '([^']*)', (true|false)\)/g)].map((m) => [m[1]!, m[2]!, m[3] === "true"]);
}

test("the database's passage overlap is checked against the TypeScript rule", () => {
  const cases = verifiedCases();
  expect(cases.length).toBeGreaterThan(4);
  for (const [a, b, expected] of cases) expect(passagesOverlap(a, b)).toBe(expected);
});
