/* Writes a copy of docs/note-examples.md without the examples on one post, so
 * GPT cannot see the notes it is measured against. A block goes when it links
 * the post or quotes the start of any note on the post, because some blocks
 * link a review page instead of the post. Usage:
 *   bun run examplesWithout.ts <slug>
 * It reads out/ground-truth.json and writes out/examples-without-<slug>.md. */

import { readFileSync, writeFileSync } from "fs";
import * as path from "path";

const slug = process.argv[2];
if (!slug) throw new Error("Usage: bun run examplesWithout.ts <slug>");
// The examples file sometimes shortens a post's address, and it quotes notes in
// full, so a shorter start of each is enough to recognise them.
const POST_PATH_PREFIX_LENGTH = 30;
const NOTE_PREFIX_LENGTH = 50;

const OUT = path.join(import.meta.dir, "out");
const groundTruth: { slug: string; url: string; notes: { note: string }[] }[] = JSON.parse(readFileSync(path.join(OUT, "ground-truth.json"), "utf8"));
const post = groundTruth.find((p) => p.slug === slug);
if (!post) throw new Error(`No post ${slug} in the ground truth`);
const markers = [new URL(post.url).pathname.slice(0, POST_PATH_PREFIX_LENGTH), ...post.notes.map((n) => n.note.slice(0, NOTE_PREFIX_LENGTH))];

const examples = readFileSync(path.join(import.meta.dir, "../../../docs/note-examples.md"), "utf8");
const blocks = examples.split(/(?=^#{2,3} )/m);
const kept = blocks.filter((block) => !(block.startsWith("### ") && markers.some((marker) => block.includes(marker))));
writeFileSync(path.join(OUT, `examples-without-${slug}.md`), kept.join(""));
console.log(`${slug}: removed ${blocks.length - kept.length} examples, kept ${kept.length} blocks.`);
