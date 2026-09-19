import { expect, test } from "bun:test";
import { readdirSync } from "fs";

/** These numbers were used twice before this check existed. Both files of each
 *  pair have been applied in production, so renaming them now would only
 *  confuse anyone comparing the folder with the database. New numbers must be
 *  unique, because migrations are applied by hand in number order and a second
 *  file with a number someone already applied is easy to miss. */
const NUMBERS_USED_TWICE_BEFORE_THIS_CHECK = new Set([
  "014", "056", "058", "067", "068", "069", "070", "077", "079",
  "080", "081", "082", "085", "086", "087", "088", "094",
]);

/** A migration can come with helper files that share its number, such as
 *  `086_creators.fixture.sql` and `086_creators.verify.sql`. Only the migration
 *  itself counts. */
const HELPER_FILE = /\.(fixture|verify)\.sql$/;

function migrationFilesByNumber(): Map<string, string[]> {
  const byNumber = new Map<string, string[]>();
  for (const file of readdirSync(import.meta.dir)) {
    const number = file.match(/^(\d+)_.*\.sql$/)?.[1];
    if (!number || HELPER_FILE.test(file)) continue;
    byNumber.set(number, [...(byNumber.get(number) ?? []), file]);
  }
  return byNumber;
}

test("no two migrations share a number", () => {
  const duplicates = [...migrationFilesByNumber()]
    .filter(([number, files]) => files.length > 1 && !NUMBERS_USED_TWICE_BEFORE_THIS_CHECK.has(number))
    .map(([, files]) => files.join(" and "));
  expect(duplicates).toEqual([]);
});
