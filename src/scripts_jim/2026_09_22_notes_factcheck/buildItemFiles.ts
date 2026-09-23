// Write one JSON file per in-scope item: the item, its body text, and every
// AI-written text note on it with the claim and the note's sources.
// The reviewer subagents read these files and nothing else from the database.
import { mkdirSync, writeFileSync } from "fs";

const DIR = "src/scripts_jim/2026_09_22_notes_factcheck";
const EXCLUDED_PROJECTS = new Set(["web", "ai-2040", "arctotherium"]);
const YOUTUBE_PROJECTS_IN_SCOPE = new Set([
  "dwarkeshpatel", "sabinehossenfelder", "hankschannel", "jacob_rees_mogg", "moneymacro", "elephantsinrooms", "jeffnippard",
]);
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

const d = JSON.parse(await Bun.file(`${DIR}/dump.json`).text());
const texts = JSON.parse(await Bun.file(`${DIR}/fullText.json`).text());
const projects = new Map<string, any>(d.projects.map((p: any) => [p.id, p]));
const items = new Map<string, any>(d.items.map((i: any) => [i.id, i]));
const claims = new Map<string, any>(d.claims.map((c: any) => [c.id, c]));
const sourcesByNote = new Map<string, any[]>();
for (const s of d.sources) (sourcesByNote.get(s.note_id) ?? sourcesByNote.set(s.note_id, []).get(s.note_id)!).push(s);

function inScope(project: any, item: any): boolean {
  if (!project || EXCLUDED_PROJECTS.has(project.slug)) return false;
  if (item.source === "youtube") return YOUTUBE_PROJECTS_IN_SCOPE.has(project.slug);
  return true;
}

const notesByItem = new Map<string, any[]>();
for (const n of d.notes) {
  if (n.author_id || n.status !== "published") continue;
  const c = claims.get(n.claim_id);
  if (!c || (c.image_urls ?? []).length > 0) continue;
  const it = items.get(c.item_id);
  if (!it || !inScope(projects.get(it.project_id), it)) continue;
  (notesByItem.get(it.id) ?? notesByItem.set(it.id, []).get(it.id)!).push({
    note_id: n.id,
    commonnotes_url: `https://commonnotes.net/?project=${projects.get(it.project_id).slug}&note=${n.id}`,
    note: n.note,
    votes: { helpful: n.helpful_count, not_helpful: n.not_helpful_count },
    claim: c.claim,
    extractor_judgement: c.judgement,
    context_quote: c.context_quote,
    updated_quote: c.updated_quote,
    context_paragraph: c.context_paragraph,
    context_url: c.context_url,
    start_seconds: c.start_seconds,
    end_seconds: c.end_seconds,
    sources: (sourcesByNote.get(n.id) ?? []).map((s) => ({ url: s.url, quote: s.quote, explanation: s.explanation })),
  });
}

mkdirSync(`${DIR}/items`, { recursive: true });
const index: any[] = [];
for (const [itemId, notes] of notesByItem) {
  const it = items.get(itemId);
  const p = projects.get(it.project_id);
  const file = `${DIR}/items/${p.slug}__${itemId}.json`;
  writeFileSync(file, JSON.stringify({
    item_id: itemId, project_slug: p.slug, creator: p.name, source: it.source, url: it.url, title: it.title,
    published_at: it.published_at, full_text: texts[itemId] ?? null, notes,
  }, null, 2));
  index.push({ file, project: p.slug, creator: p.name, title: it.title, url: it.url, notes: notes.length, hasFullText: !!texts[itemId] });
}
index.sort((a, b) => a.project.localeCompare(b.project) || a.title.localeCompare(b.title));
writeFileSync(`${DIR}/items/index.json`, JSON.stringify(index, null, 2));
console.log("items", index.length, "notes", index.reduce((s, r) => s + r.notes, 0));
const perProject: Record<string, number> = {};
for (const r of index) perProject[r.project] = (perProject[r.project] ?? 0) + r.notes;
console.log(perProject);
