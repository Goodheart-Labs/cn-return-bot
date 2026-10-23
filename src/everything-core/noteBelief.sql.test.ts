import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { probabilityHelpful } from "./noteBelief";
import { noteStatus } from "./noteScore";

/* The database ranks the website's feed with its own copy of the chance that a
 * note ends up rated helpful (migration 139), because it has to sort notes by
 * it. The migration's verify file checks the database's values against the
 * numbers below it lists. This test checks those same numbers against the
 * TypeScript functions. So a change to the model here fails this test until
 * the verify file, and with it the SQL copy, is changed too. */

const VERIFY_FILE = join(import.meta.dir, "../../migrations/139_paged_lists.verify.sql");

/** The (helpful, somewhat helpful, not helpful, expected chance) rows the
 *  verify file checks the database against. */
function verifiedValues(): [number, number, number, number][] {
  const sql = readFileSync(VERIFY_FILE, "utf8");
  const rows = [...sql.matchAll(/\((\d+), (\d+), (\d+), ([\d.e-]+)\)/g)];
  return rows.map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]);
}

test("the database's chance of ending up helpful is checked against the TypeScript values", () => {
  const values = verifiedValues();
  expect(values.length).toBeGreaterThan(5);
  for (const [helpful, somewhatHelpful, notHelpful, expected] of values) {
    expect(probabilityHelpful({ helpful, somewhatHelpful, notHelpful })).toBeCloseTo(expected, 12);
  }
});

test("the status thresholds the verify file checks hold in TypeScript", () => {
  const status = (helpful: number, somewhat: number, notHelpful: number) =>
    noteStatus({ helpful_count: helpful, somewhat_helpful_count: somewhat, not_helpful_count: notHelpful, author_id: null });
  expect(status(2, 0, 0)).toBe("needs_ratings");
  expect(status(2, 1, 0)).toBe("helpful");
  expect(status(0, 0, 1)).toBe("needs_ratings");
  expect(status(0, 0, 2)).toBe("not_helpful");
});
