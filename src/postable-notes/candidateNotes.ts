/**
 * Lists the Common Notes that might be worth posting on X, for the daily
 * postable-notes job (GOO-452). candidates.ts says what makes a note a
 * candidate.
 *
 *   bun run candidate-notes                          # the last day
 *   bun run candidate-notes --days 14
 *   bun run candidate-notes --since 2026-10-15T13:00:00Z
 *   bun run candidate-notes --posted <file>          # leave out notes posted before, unless they got new votes
 *   bun run candidate-notes --json                   # everything, including the paragraph and the sources
 *
 * The posted file has one line per note the job posted: the note id, a space,
 * and the ISO time of the post. It reads the production database through
 * SUPABASE_URL and SUPABASE_SERVICE_KEY.
 */

import "dotenv/config";
import * as fs from "fs";
import { findCandidates, parsePostedLog, type Candidate, type Reason } from "./candidates";

const DEFAULT_DAYS = 1;
const DAY_MS = 86_400_000;

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function describeReason(reason: Reason): string {
  switch (reason.type) {
    case "rated_helpful":
      return "rated helpful";
    case "helpful_votes": {
      const team = reason.fromTeam > 0 ? `, ${reason.fromTeam} of them from the team` : "";
      return `${reason.helpful} new Helpful and ${reason.somewhatHelpful} new Somewhat helpful votes${team}`;
    }
    case "written_by_person":
      return `written by ${reason.author}`;
    case "important_creator":
      return "new note on an important creator";
  }
}

function formatCandidate(candidate: Candidate): string {
  const { tally, item } = candidate;
  const oneLine = (text: string) => text.replace(/\s*\n+\s*/g, " ");
  const lines = [
    `## ${candidate.noteId}: ${candidate.reasons.map(describeReason).join("; ")}`,
    `On: ${item.title}${item.creator ? ` (${item.creator})` : ""} ${item.url}`,
    `Written ${candidate.writtenAt.slice(0, 10)} by ${candidate.author ?? "our AI"}${candidate.isImprovement ? " (an improvement of another note)" : ""}`,
    `Votes: ${tally.helpful} Helpful, ${tally.somewhatHelpful} Somewhat, ${tally.notHelpful} Not helpful (${tally.fromTeam} from the team). Status ${candidate.status}, without team votes ${candidate.statusWithoutTeam}`,
    `Passage: ${candidate.passage ? oneLine(candidate.passage) : "(an image)"}`,
    `Note: ${oneLine(candidate.note)}`,
    `Sources: ${[...new Set(candidate.sources.map((source) => source.url))].join(" ") || "none"}`,
    `Link: ${candidate.minisiteUrl ?? candidate.noteUrl}`,
  ];
  if (candidate.postedAt) lines.push(`Posted before on ${candidate.postedAt.slice(0, 10)}`);
  return lines.join("\n");
}

const days = Number(readFlag("--days") ?? DEFAULT_DAYS);
const since = readFlag("--since") ?? new Date(Date.now() - days * DAY_MS).toISOString();
const postedFile = readFlag("--posted");
const posted = parsePostedLog(postedFile && fs.existsSync(postedFile) ? fs.readFileSync(postedFile, "utf8") : "");
const candidates = await findCandidates(since, posted);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(candidates, null, 2));
} else {
  console.log(`${candidates.length} candidate notes since ${since}, strongest first\n`);
  console.log(candidates.map(formatCandidate).join("\n\n"));
}
