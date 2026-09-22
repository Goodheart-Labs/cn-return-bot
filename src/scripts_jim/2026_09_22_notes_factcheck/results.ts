// Build RESULTS.md for Nathan from the two review passes.
// Section 1: notes both passes call good. Section 2: notes the second pass calls
// uncertain. Section 3: Jim's hand-picked notes with what the review found.
// Section 4: a short appendix of everything rejected, one line per note.
import { existsSync, readdirSync, writeFileSync } from "fs";

const DIR = "src/scripts_jim/2026_09_22_notes_factcheck";
const JIM_PICKS: Record<string, string> = {
  "aaf8ce54-d55e-40e9-b77a-babc6176164f": "good", "a49ea74e-84a0-41b6-94ac-7453fdcd27ce": "good",
  "756db75a-b033-4d92-8d13-97cc4ee3f9ff": "maybe", "6cd32628-f9b0-483d-ab0a-73ae4d2f987f": "maybe",
  "aa92ccd3-778b-40c1-a8b0-0a9b7bc3dcf8": "maybe", "dad2df5b-0986-416f-b9e7-e21355208df6": "good",
  "264d5f04-0250-4367-bbe0-48a976de59ad": "good", "1ff38adf-1006-4694-8cea-b7cbb4e3c56d": "good",
  "9a30d1f1-24c6-48ba-9099-8afdeb2060c6": "good", "e999483e-947b-4f81-b366-dd1d2d1e48e8": "good",
  "1467076f-49e2-42da-8d98-4e8ad7aaa4ba": "good", "971736a5-d686-4acf-bd35-70f679ac4b56": "good",
  "c03cd937-681e-4a31-b49b-c172e501b43f": "good", "bd06c77d-050a-4348-9f6d-d75e9d9af0aa": "good",
  "d02d3244-ad51-492a-94b8-e73de7dbd711": "good", "586e85d9-fc97-4355-9676-8d7330bf60c4": "good (in citation)",
  "69f1431b-c15b-41bb-92d5-2a4dbb7a4030": "maybe", "6c3ab86e-d1df-4ba7-bfa0-7ff2023bf856": "good",
  "cb0c9281-ab91-4895-8ee9-b1b7cebef26f": "good (in citation)", "7dbf7143-ca9b-449f-84f2-6c7423ed01d3": "good",
  "2b05dc45-3dc8-4ec4-8a3f-6bf5b218dbe6": "good",
};
// Creators whose politics matter for whether they would accept a note.
const VIEWPOINT_CREATORS = new Set(["elephantsinrooms", "jacob_rees_mogg"]);

interface Review { note_id: string; verdict: string; reason: string; whose_words?: string; send_advice?: string | null; author_would_accept?: string }
interface Entry {
  project: string; creator: string; title: string; url: string; source: string;
  note_id: string; commonnotes_url: string; note: string; claim: string; context_quote: string | null;
  opus?: Review; fable?: Review; votes: { helpful: number; not_helpful: number };
}

const index = JSON.parse(await Bun.file(`${DIR}/items/index.json`).text()) as { file: string }[];
const entries: Entry[] = [];
let fableMissing = 0;
for (const row of index) {
  const base = row.file.split("/").pop()!;
  const item = JSON.parse(await Bun.file(row.file).text());
  const opusPath = `${DIR}/reviews/opus/${base}`;
  const fablePath = `${DIR}/reviews/fable/${base}`;
  const opus = existsSync(opusPath) ? new Map<string, Review>(JSON.parse(await Bun.file(opusPath).text()).notes.map((n: Review) => [n.note_id, n])) : new Map();
  const fable = existsSync(fablePath) ? new Map<string, Review>(JSON.parse(await Bun.file(fablePath).text()).notes.map((n: Review) => [n.note_id, n])) : new Map();
  for (const n of item.notes) {
    const o = opus.get(n.note_id);
    const f = fable.get(n.note_id);
    if (o && o.verdict !== "bad" && !f) fableMissing++;
    entries.push({
      project: item.project_slug, creator: item.creator, title: item.title, url: item.url, source: item.source,
      note_id: n.note_id, commonnotes_url: n.commonnotes_url, note: n.note, claim: n.claim, context_quote: n.context_quote,
      opus: o, fable: f, votes: n.votes,
    });
  }
}

function finalVerdict(e: Entry): "good" | "uncertain" | "bad" | "pending" {
  if (!e.opus) return "pending";
  if (e.opus.verdict === "bad") return "bad";
  if (!e.fable) return "pending";
  return e.fable.verdict as "good" | "uncertain" | "bad";
}

const creatorOrder = [...new Set(entries.map((e) => e.creator))].sort();
function byCreator(list: Entry[]): Map<string, Entry[]> {
  const m = new Map<string, Entry[]>();
  for (const c of creatorOrder) { const xs = list.filter((e) => e.creator === c); if (xs.length) m.set(c, xs); }
  return m;
}
function quote(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}
function noteBlock(e: Entry, reason: string): string {
  const lines = [
    `#### ${e.title}`,
    ``,
    `- Link: ${e.commonnotes_url}`,
    `- Post: ${e.url}`,
    e.fable?.whose_words ? `- Whose words: ${e.fable.whose_words}` : "",
    VIEWPOINT_CREATORS.has(e.project) && e.fable?.author_would_accept ? `- Would the creator accept it: ${e.fable.author_would_accept}` : "",
    JIM_PICKS[e.note_id] ? `- Jim's pick: ${JIM_PICKS[e.note_id]}` : "",
    ``,
    `**The passage:** ${quote(e.context_quote) || quote(e.claim)}`,
    ``,
    `**The note:** ${quote(e.note)}`,
    ``,
    `**Why:** ${quote(reason)}`,
    e.fable?.send_advice ? `\n**Before sending:** ${quote(e.fable.send_advice)}` : "",
    ``,
  ];
  return lines.filter((l) => l !== "").join("\n") + "\n";
}

const good = entries.filter((e) => finalVerdict(e) === "good");
const uncertain = entries.filter((e) => finalVerdict(e) === "uncertain");
const bad = entries.filter((e) => finalVerdict(e) === "bad");
const pending = entries.filter((e) => finalVerdict(e) === "pending");

let md = `# Common Notes worth sending to their authors\n\n`;
md += `Reviewed on 2026-09-22 for GOO-217. Every AI-written Common Note on a reachable creator was checked twice: an Opus reviewer read the whole post and judged each note, and a Fable reviewer re-read the source and re-judged every note the first pass did not reject. Image-grounded notes, user-written notes and the YouTubers outside Jim's list were left out.\n\n`;
md += `| | Notes |\n|---|---|\n| Reviewed | ${entries.length} |\n| Confident, send | ${good.length} |\n| Uncertain, Nathan decides | ${uncertain.length} |\n| Rejected | ${bad.length} |\n| Still pending | ${pending.length} |\n\n`;
md += `The two sections below are ordered by creator. Inside a creator, notes on the same post sit together; when two notes correct the same sentence, the text says which one to send. "Whose words" says whether the corrected sentence is the creator's own, a guest's, or a quoted source's. For Ken LaCorte and Jacob Rees-Mogg the review also says whether the creator would plausibly accept the note.\n\n`;

md += `## 1. Confident: both reviewers call the note correct, fair and substantive\n\n`;
for (const [creator, xs] of byCreator(good)) {
  md += `### ${creator}\n\n`;
  for (const e of xs) md += noteBlock(e, e.fable!.reason);
}

md += `## 2. Uncertain: the second reviewer sees a real point but has a reservation\n\n`;
for (const [creator, xs] of byCreator(uncertain)) {
  md += `### ${creator}\n\n`;
  for (const e of xs) md += noteBlock(e, e.fable!.reason);
}

md += `## 3. Jim's hand-picked notes, and what the review found\n\n`;
md += `| Note | Jim | Opus | Fable | Short reason |\n|---|---|---|---|---|\n`;
for (const [id, pick] of Object.entries(JIM_PICKS)) {
  const e = entries.find((x) => x.note_id === id);
  if (!e) { md += `| ${id} | ${pick} | not in scope | | image-grounded or excluded project |\n`; continue; }
  const r = e.fable?.reason ?? e.opus?.reason ?? "";
  md += `| [${e.creator}: ${quote(e.title).slice(0, 50)}](${e.commonnotes_url}) | ${pick} | ${e.opus?.verdict ?? "pending"} | ${e.fable?.verdict ?? (e.opus?.verdict === "bad" ? "not re-checked" : "pending")} | ${quote(r).slice(0, 220)} |\n`;
}

md += `\n## 4. Rejected notes, one line each\n\n`;
for (const [creator, xs] of byCreator(bad)) {
  md += `**${creator}**\n\n`;
  for (const e of xs) {
    const r = e.fable?.verdict === "bad" ? e.fable.reason : e.opus!.reason;
    md += `- [${quote(e.title).slice(0, 60)}](${e.commonnotes_url}): ${quote(r).slice(0, 260)}\n`;
  }
  md += `\n`;
}
if (pending.length) md += `\n## Pending\n\n${pending.length} notes still await the second pass.\n`;

writeFileSync(`${DIR}/RESULTS.md`, md);
console.log({ good: good.length, uncertain: uncertain.length, bad: bad.length, pending: pending.length, fableMissing });
