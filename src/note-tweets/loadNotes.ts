import { INPUT_DIR } from "./paths";
import { parseResults } from "./parseResults";
import type { Article, Note } from "./types";

export async function loadNotes(URL_: string, key: string, articleArgs: string[]) {
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const sel = "id,note,sources:everything_note_sources(url,sort_order),author_id,helpful_count,somewhat_helpful_count,not_helpful_count,created_at,everything_claims(claim,context_quote,context_paragraph,updated_quote,context_url,everything_items(title,url,published_at,everything_projects(slug,name)))";
  const rows: Note[] = [];
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${URL_}/rest/v1/everything_notes?select=${sel}&or=(helpful_count.gt.0,somewhat_helpful_count.gt.0,not_helpful_count.gt.0)&limit=1000&offset=${off}`, { headers: h });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const page = await r.json(); rows.push(...page);
    if (page.length < 1000) break;
  }

  const results = await Bun.file(new URL("../scripts_jim/2026_09_22_notes_factcheck/RESULTS.md", import.meta.url)).text();
  const jim = parseResults(results);
  const have = new Set(rows.map(r => r.id));
  const extra = [...jim.keys()].filter(id => !have.has(id));
  const fetchNotes = async (ids: string[]) => {
    for (let i = 0; i < ids.length; i += 50) {
      const r = await fetch(`${URL_}/rest/v1/everything_notes?select=${sel}&id=in.(${ids.slice(i, i + 50).join(",")})`, { headers: h });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      rows.push(...await r.json());
    }
  };
  await fetchNotes(extra);
  const ARTICLES = `${INPUT_DIR}/articles.json`;
  const articleUrls: string[] = (await Bun.file(ARTICLES).exists()) ? await Bun.file(ARTICLES).json() : [];
  for (const a of articleArgs) if (!articleUrls.includes(a)) articleUrls.push(a);
  await Bun.write(ARTICLES, JSON.stringify(articleUrls, null, 2));
  const articles: Article[] = [];
  for (const [i, url] of articleUrls.entries()) {
    const items: { id: string; title: string }[] = await (await fetch(`${URL_}/rest/v1/everything_items?select=id,title&url=eq.${encodeURIComponent(url)}`, { headers: h })).json();
    if (!items.length) { console.warn("no Common Notes item for", url); continue; }
    const claims: { everything_notes: { id: string }[] }[] = await (await fetch(`${URL_}/rest/v1/everything_claims?select=everything_notes(id)&item_id=in.(${items.map((x) => x.id).join(",")})`, { headers: h })).json();
    const ids = new Set<string>(claims.flatMap((c) => c.everything_notes.map((n) => n.id)));
    articles.push({ key: `a${i}`, title: items[0]!.title, ids });
    const have = new Set(rows.map(r => r.id));
    await fetchNotes([...ids].filter(id => !have.has(id)));
  }

  const helpfulAt = new Map<string, string[]>();
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${URL_}/rest/v1/everything_votes?select=note_id,created_at&vote=eq.1&order=created_at.asc&limit=1000&offset=${off}`, { headers: h });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const page = await r.json();
    for (const v of page) helpfulAt.set(v.note_id, [...(helpfulAt.get(v.note_id) ?? []), v.created_at]);
    if (page.length < 1000) break;
  }
  return { rows, jim, articles, helpfulAt, extra };
}
