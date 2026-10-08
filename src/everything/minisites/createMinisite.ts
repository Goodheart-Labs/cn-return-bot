/**
 * Creates a minisite from the command line, through the same path the website
 * uses. It reads the page in this process, writes a finished read_page job row
 * with the result, and calls everything_create_minisite on that job. Both
 * writes use the service key.
 *
 * Usage:
 *   bun run minisite-create <url> --slug <slug> [--features id,id,...]
 *     [--title "…"] [--description "…"] [--doc <file>] [--dry-run]
 *
 *   --features     feature ids from src/everything-core/minisiteFeatures.ts;
 *                  every feature when left out
 *   --title        replaces the page's own title
 *   --description  replaces the page's own description
 *   --doc <file>   a file in reader text that replaces the article text, for a
 *                  page the reader gets wrong. With --title it also works for a
 *                  page that cannot be read at all.
 *   --dry-run      prints what would be created and writes nothing
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { getSupabaseClient } from "../../api/supabaseClient";
import { checked } from "../../api/supabaseResult";
import { ALL_FEATURES, type FeatureId } from "../../everything-core/minisiteFeatures";
import { plainText } from "../../everything-core/readerText";
import { PageReadError, readPageForMinisite, type MinisitePage } from "./readPage";
import { readerTextStats } from "./readerTextStats";

const MINISITES_URL = "https://commonnotes.net/minisites";
/** How much of the article text a dry run prints. */
const PREVIEW_CHARS = 1500;
/** The slug rule of everything_minisites (migration 117), checked here so a
 *  bad slug fails before the page is read. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG_CHARS = 80;
const RESERVED_SLUG = "new";

interface Options {
  url: string;
  slug: string;
  features: FeatureId[];
  title?: string;
  description?: string;
  docFile?: string;
  dryRun: boolean;
}

function parseFeatures(list: string | undefined): FeatureId[] {
  if (list === undefined) return [...ALL_FEATURES];
  const ids = list.split(",").map((id) => id.trim()).filter(Boolean);
  const unknown = ids.filter((id) => !(ALL_FEATURES as readonly string[]).includes(id));
  if (unknown.length) throw new Error(`Unknown feature ids: ${unknown.join(", ")}. Known ids: ${ALL_FEATURES.join(", ")}`);
  return ids as FeatureId[];
}

function checkSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug) || slug.length > MAX_SLUG_CHARS || slug === RESERVED_SLUG) {
    throw new Error(`The slug "${slug}" must be lowercase letters, digits and single dashes, at most ${MAX_SLUG_CHARS} characters, and not "${RESERVED_SLUG}".`);
  }
}

function parseOptions(): Options {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      slug: { type: "string" },
      features: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      doc: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const [url, ...extra] = positionals;
  if (!url || extra.length || !values.slug) throw new Error("Usage: bun run minisite-create <url> --slug <slug> [--features id,id] [--title …] [--description …] [--doc <file>] [--dry-run]");
  checkSlug(values.slug);
  return {
    url,
    slug: values.slug,
    features: parseFeatures(values.features),
    title: values.title,
    description: values.description,
    docFile: values.doc,
    dryRun: values["dry-run"],
  };
}

/** With --doc the page is still read for its title, byline and picture. When
 *  it cannot be read and a --title is given, the minisite goes ahead with only
 *  what the flags say. */
async function readPage(options: Options): Promise<MinisitePage> {
  if (!options.docFile) return readPageForMinisite(options.url);
  const content = readFileSync(options.docFile, "utf8").trim();
  const read = await readPageForMinisite(options.url).catch((err: unknown) => {
    if (err instanceof PageReadError && options.title) return null;
    throw err;
  });
  const header = read ?? { title: options.title!, description: "", byline: null, published_at: null, image_url: null, creator_feed_url: null };
  return { ...header, content, plain_text: plainText(content) };
}

function printDryRun(options: Options, page: MinisitePage, title: string, description: string): void {
  console.log(`Would create ${MINISITES_URL}/${options.slug}`);
  console.log({
    title,
    description,
    byline: page.byline,
    published_at: page.published_at,
    image_url: page.image_url,
    creator_feed_url: page.creator_feed_url,
    features: options.features,
    counts: readerTextStats(page.content),
    characters: { content: page.content.length, plain_text: page.plain_text.length },
  });
  console.log(`\nThe first ${PREVIEW_CHARS} characters of the content:\n`);
  console.log(page.content.slice(0, PREVIEW_CHARS));
}

async function createMinisite(options: Options, page: MinisitePage, title: string, description: string): Promise<string> {
  const db = getSupabaseClient();
  const now = new Date().toISOString();
  const job = checked(await db.from("everything_minisite_jobs")
    .insert({ kind: "read_page", url: options.url, status: "done", result: page, started_at: now, finished_at: now })
    .select("id").single()) as { id: string };
  return checked(await db.rpc("everything_create_minisite", {
    job_id: job.id, new_slug: options.slug, new_title: title, new_description: description, new_features: options.features,
  })) as string;
}

async function main() {
  const options = parseOptions();
  const page = await readPage(options);
  const title = options.title ?? page.title;
  const description = options.description ?? page.description;
  if (options.dryRun) return printDryRun(options, page, title, description);
  const slug = await createMinisite(options, page, title, description);
  console.log(`Created the minisite "${slug}": ${MINISITES_URL}/${slug}`);
}

await main();
