/**
 * Build overview.html from classified.json — a scannable decision aid for
 * deciding which prod Zvi notes to delete/replace after the new-input rerun.
 *
 *   bun run src/scripts_jim/2026_07_20_zvi_rerun_new_input/buildOverview.ts
 */

import * as fs from "fs";
import * as path from "path";

interface Source { url: string; quote: string | null; explanation: string | null }
interface Entry {
  claimId: string;
  itemTitle: string | null;
  itemUrl: string;
  contextUrl: string | null;
  claim: string;
  highlighted: string;
  paragraph: string;
  oldNote: string;
  oldSources: Source[];
  newOutcome: { kind: "note"; note: string; sources: Source[] } | { kind: "no_note"; outcome: string; reason: string | null };
  bucket: "same" | "different" | "no_note";
  rationale: string | null;
}

const DIR = __dirname;
const entries: Entry[] = JSON.parse(fs.readFileSync(path.join(DIR, "classified.json"), "utf8"));

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };

// Actual captured search-step input per claim (media descriptions included),
// from captureSearchInput.ts. Keyed by claimId.
interface Captured { claimId: string; imageUrls: string[]; searchInput: string }
const capturedPath = path.join(DIR, "searchInputs.json");
const captured: Map<string, Captured> = fs.existsSync(capturedPath)
  ? new Map((JSON.parse(fs.readFileSync(capturedPath, "utf8")) as Captured[]).map((c) => [c.claimId, c]))
  : new Map();

// The artifact CSP blocks external image hosts, so inline every claim image as a
// data URI at build time. Falls back to a plain link if a fetch fails.
const dataUris = new Map<string, string>();
const allImageUrls = [...new Set([...captured.values()].flatMap((c) => c.imageUrls))];
await Promise.all(
  allImageUrls.map(async (u) => {
    try {
      const res = await fetch(u);
      if (!res.ok) return;
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
      dataUris.set(u, `data:${mime};base64,${buf.toString("base64")}`);
    } catch { /* leave as link-only */ }
  }),
);
console.log(`embedded ${dataUris.size}/${allImageUrls.length} images as data URIs`);

/** Highlight the media section so the image-derived part of the input stands out. */
function renderSearchInput(text: string): string {
  return esc(text).replace(
    /(^|\n)(## Media on post[\s\S]*?)(?=\n## |\n# |$)/,
    (_m, pre, block) => `${pre}<mark class="media-block">${block}</mark>`,
  );
}

function thumb(u: string): string {
  const data = dataUris.get(u);
  return `<a href="${esc(u)}" target="_blank" rel="noopener" class="thumb">${
    data ? `<img src="${data}" alt="claim image">` : `<span class="thumb-link">image ↗</span>`
  }</a>`;
}

function searchInputBlock(entry: Entry): string {
  const cap = captured.get(entry.claimId);
  if (!cap) return "";
  const imgs = cap.imageUrls.length;
  return `<details class="search-input${imgs ? " has-img" : ""}">
    <summary>Search-step input${imgs ? ` <span class="imgcount">${imgs} image${imgs > 1 ? "s" : ""}</span>` : ""}</summary>
    ${imgs ? `<div class="thumbs">${cap.imageUrls.map(thumb).join("")}</div>` : ""}
    <pre class="si">${renderSearchInput(cap.searchInput)}</pre>
  </details>`;
}

const BUCKETS = [
  { key: "no_note", label: "No note on rerun", blurb: "The claim no longer produces a note — candidate for deletion in prod." },
  { key: "different", label: "Different note", blurb: "Still a note, but a materially different correction — review before keeping." },
  { key: "same", label: "Basically the same", blurb: "Same correction and verdict — safe to leave as-is." },
] as const;

const count = (k: string) => entries.filter((e) => e.bucket === k).length;

function sourcesHtml(sources: Source[]): string {
  if (!sources.length) return `<div class="src-empty">no sources</div>`;
  return `<ul class="src">${sources
    .map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(host(s.url))}</a>${
      s.quote ? `<span class="q">“${esc(s.quote)}”</span>` : ""
    }</li>`)
    .join("")}</ul>`;
}

function noteColumn(kind: "old" | "new", entry: Entry): string {
  if (kind === "old") {
    return `<div class="col old">
      <div class="col-head"><span class="tag">OLD note</span><span class="col-sub">currently in prod</span></div>
      <p class="note-text">${esc(entry.oldNote)}</p>
      ${sourcesHtml(entry.oldSources)}
    </div>`;
  }
  if (entry.newOutcome.kind === "no_note") {
    return `<div class="col new none">
      <div class="col-head"><span class="tag">NEW</span><span class="col-sub">no note produced</span></div>
      <p class="note-none">No correction on rerun<span class="reason">${esc(entry.newOutcome.reason ?? entry.newOutcome.outcome)}</span></p>
    </div>`;
  }
  return `<div class="col new">
    <div class="col-head"><span class="tag">NEW note</span><span class="col-sub">verbatim-claim input</span></div>
    <p class="note-text">${esc(entry.newOutcome.note)}</p>
    ${sourcesHtml(entry.newOutcome.sources)}
  </div>`;
}

function card(entry: Entry): string {
  const src = entry.contextUrl
    ? `<a class="item" href="${esc(entry.contextUrl)}" target="_blank" rel="noopener">${esc(entry.itemTitle ?? "source")}</a>`
    : `<span class="item">${esc(entry.itemTitle ?? "source")}</span>`;
  return `<article class="card ${entry.bucket}" data-bucket="${entry.bucket}">
    <header class="card-head">
      <span class="dot"></span>
      ${src}
      <code class="cid">${esc(entry.claimId.slice(0, 8))}</code>
    </header>
    <div class="claim">
      <div class="claim-label">Highlighted claim</div>
      <p class="highlighted">${esc(entry.highlighted || "(image-only claim)")}</p>
      ${entry.paragraph && entry.paragraph !== entry.highlighted
        ? `<details class="para"><summary>surrounding paragraph</summary><p>${esc(entry.paragraph)}</p></details>`
        : ""}
      ${searchInputBlock(entry)}
    </div>
    <div class="cols">${noteColumn("old", entry)}${noteColumn("new", entry)}</div>
    ${entry.rationale ? `<footer class="why"><span class="why-label">${entry.bucket === "no_note" ? "reason" : "judge"}</span>${esc(entry.rationale)}</footer>` : ""}
  </article>`;
}

const sections = BUCKETS.map((b) => {
  const rows = entries.filter((e) => e.bucket === b.key);
  if (!rows.length) return "";
  return `<section class="bucket" id="sec-${b.key}" data-bucket="${b.key}">
    <div class="bucket-head">
      <h2 class="${b.key}">${b.label}<span class="n">${rows.length}</span></h2>
      <p class="blurb">${b.blurb}</p>
    </div>
    <div class="cards">${rows.map(card).join("")}</div>
  </section>`;
}).join("");

const html = `<title>Zvi notes · new-input rerun</title>
<style>
:root{
  --bg:#f4f6f8; --panel:#ffffff; --ink:#181b22; --muted:#5c6472; --faint:#8a92a0;
  --line:#e3e7ec; --line2:#eef1f4;
  --slate:#334155;
  --nonote:#b45309; --nonote-bg:#fdf3e7; --nonote-line:#f0d9b8;
  --diff:#4f46e5; --diff-bg:#eef0fe; --diff-line:#d5d9fb;
  --same:#0f766e; --same-bg:#e9f4f2; --same-line:#c5e2dd;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --serif:ui-serif,Georgia,"Times New Roman",serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#101319; --panel:#181c24; --ink:#e7eaf0; --muted:#9aa3b2; --faint:#6b7484;
  --line:#262c37; --line2:#20252e;
  --nonote:#f0a352; --nonote-bg:#2a1f12; --nonote-line:#4a3417;
  --diff:#a9adfb; --diff-bg:#1b1c30; --diff-line:#31335a;
  --same:#5ec8bb; --same-bg:#122523; --same-line:#1f453f;
}}
:root[data-theme="dark"]{
  --bg:#101319; --panel:#181c24; --ink:#e7eaf0; --muted:#9aa3b2; --faint:#6b7484;
  --line:#262c37; --line2:#20252e;
  --nonote:#f0a352; --nonote-bg:#2a1f12; --nonote-line:#4a3417;
  --diff:#a9adfb; --diff-bg:#1b1c30; --diff-line:#31335a;
  --same:#5ec8bb; --same-bg:#122523; --same-line:#1f453f;
}
:root[data-theme="light"]{
  --bg:#f4f6f8; --panel:#ffffff; --ink:#181b22; --muted:#5c6472; --faint:#8a92a0;
  --line:#e3e7ec; --line2:#eef1f4;
  --nonote:#b45309; --nonote-bg:#fdf3e7; --nonote-line:#f0d9b8;
  --diff:#4f46e5; --diff-bg:#eef0fe; --diff-line:#d5d9fb;
  --same:#0f766e; --same-bg:#e9f4f2; --same-line:#c5e2dd;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;
  font-size:15px;-webkit-font-smoothing:antialiased}
a{color:inherit}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px 80px}

header.top{padding:40px 0 20px}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin:0 0 10px}
h1{font-family:var(--serif);font-weight:600;font-size:30px;line-height:1.15;margin:0 0 8px;text-wrap:balance}
.lede{color:var(--muted);max-width:64ch;margin:0}
.lede code{font-family:var(--mono);font-size:.86em;background:var(--line2);padding:1px 5px;border-radius:4px}

.summary{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);
  backdrop-filter:blur(8px);border-bottom:1px solid var(--line);margin:18px -20px 0;padding:12px 20px;
  display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.stat{appearance:none;cursor:pointer;background:var(--panel);border:1px solid var(--line);border-radius:10px;
  padding:9px 14px;display:flex;align-items:baseline;gap:9px;font:inherit;color:inherit;transition:border-color .15s,transform .05s}
.stat:hover{transform:translateY(-1px)}
.stat[aria-pressed="true"]{border-color:currentColor}
.stat .num{font-family:var(--serif);font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}
.stat .lbl{font-size:13px;color:var(--muted)}
.stat.no_note{color:var(--nonote)} .stat.different{color:var(--diff)} .stat.same{color:var(--same)}
.stat.all{color:var(--slate)}
.stat.all[aria-pressed="true"]{border-color:var(--muted)}
.hint{margin-left:auto;font-size:12.5px;color:var(--faint)}

.bucket{margin-top:34px;scroll-margin-top:80px}
.bucket-head{border-bottom:1px solid var(--line);padding-bottom:8px;margin-bottom:18px}
.bucket-head h2{font-family:var(--serif);font-size:20px;font-weight:600;margin:0;display:flex;align-items:center;gap:10px}
.bucket-head h2.no_note{color:var(--nonote)} .bucket-head h2.different{color:var(--diff)} .bucket-head h2.same{color:var(--same)}
.bucket-head .n{font-family:var(--mono);font-size:13px;background:var(--panel);border:1px solid var(--line);
  color:var(--muted);border-radius:20px;padding:1px 9px;font-variant-numeric:tabular-nums}
.blurb{margin:5px 0 0;color:var(--muted);font-size:13.5px}

.cards{display:flex;flex-direction:column;gap:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;
  border-left:3px solid var(--edge)}
.card.no_note{--edge:var(--nonote)} .card.different{--edge:var(--diff)} .card.same{--edge:var(--same)}
.card-head{display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--line2)}
.card-head .dot{width:8px;height:8px;border-radius:50%;background:var(--edge);flex:none}
.card-head .item{font-weight:550;font-size:14px;text-decoration:none;color:var(--ink)}
a.item:hover{text-decoration:underline;text-decoration-color:var(--edge)}
.card-head .cid{margin-left:auto;font-family:var(--mono);font-size:11.5px;color:var(--faint)}

.claim{padding:14px 16px 4px}
.claim-label{font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin-bottom:5px}
.highlighted{margin:0;font-family:var(--mono);font-size:13px;line-height:1.55;color:var(--ink);
  border-left:2px solid var(--edge);padding-left:12px;white-space:pre-wrap}
.para{margin:8px 0 0}
.para summary{cursor:pointer;font-size:12px;color:var(--muted);list-style:none}
.para summary::-webkit-details-marker{display:none}
.para summary::before{content:"▸ ";color:var(--faint)}
.para[open] summary::before{content:"▾ "}
.para p{margin:8px 0 0;color:var(--muted);font-size:13px;padding-left:12px;border-left:1px solid var(--line);white-space:pre-wrap}

.search-input{margin:10px 0 0}
.search-input>summary{cursor:pointer;font-family:var(--mono);font-size:11.5px;letter-spacing:.02em;color:var(--muted);
  list-style:none;display:inline-flex;align-items:center;gap:8px;padding:4px 9px;border:1px solid var(--line);
  border-radius:7px;background:var(--panel)}
.search-input>summary::-webkit-details-marker{display:none}
.search-input>summary::before{content:"input ▸";color:var(--faint);font-size:10px}
.search-input[open]>summary::before{content:"input ▾"}
.search-input.has-img>summary{border-color:var(--nonote-line);color:var(--nonote)}
.imgcount{font-size:10px;background:var(--nonote-bg);color:var(--nonote);border-radius:20px;padding:0 7px}
.thumbs{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.thumb{display:block}
.thumbs img{max-height:170px;max-width:100%;border:1px solid var(--line);border-radius:6px;display:block}
.thumb-link{font-family:var(--mono);font-size:11px;color:var(--nonote);border:1px solid var(--nonote-line);border-radius:6px;padding:6px 10px;display:inline-block}
.si{margin:8px 0 0;font-family:var(--mono);font-size:11.5px;line-height:1.5;color:var(--muted);
  background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px 13px;
  white-space:pre-wrap;overflow-x:auto;max-height:340px;overflow-y:auto}
.si mark.media-block{background:var(--nonote-bg);color:var(--ink);display:block;border-left:2px solid var(--nonote);
  padding:6px 8px;margin:4px 0;border-radius:0 4px 4px 0}

.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:14px 16px 0;margin-top:8px}
.col{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:12px 13px;display:flex;flex-direction:column;gap:9px}
.col.new{background:var(--edge-bg,var(--panel))}
.card.no_note .col.new{--edge-bg:var(--nonote-bg);border-color:var(--nonote-line)}
.card.different .col.new{--edge-bg:var(--diff-bg);border-color:var(--diff-line)}
.card.same .col.new{--edge-bg:var(--same-bg);border-color:var(--same-line)}
.col-head{display:flex;align-items:baseline;gap:8px}
.tag{font-family:var(--mono);font-size:10px;letter-spacing:.08em;font-weight:600;color:var(--muted)}
.col-sub{font-size:11px;color:var(--faint)}
.note-text{margin:0;font-size:13.5px;line-height:1.55}
.note-none{margin:0;font-size:13.5px;color:var(--nonote);font-weight:550;display:flex;flex-direction:column;gap:4px}
.note-none .reason{font-family:var(--mono);font-size:11.5px;font-weight:400;color:var(--muted)}
.src{list-style:none;margin:2px 0 0;padding:8px 0 0;border-top:1px solid var(--line2);display:flex;flex-direction:column;gap:6px}
.src li{font-size:12px;display:flex;flex-direction:column;gap:2px}
.src a{font-family:var(--mono);font-size:11.5px;color:var(--muted);text-decoration:none}
.src a:hover{color:var(--ink);text-decoration:underline}
.src .q{color:var(--faint);font-style:italic;line-height:1.4}
.src-empty{font-size:11.5px;color:var(--faint);padding-top:8px;border-top:1px solid var(--line2)}

.why{padding:12px 16px;border-top:1px solid var(--line2);font-size:12.5px;color:var(--muted);display:flex;gap:9px}
.why-label{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);
  flex:none;padding-top:2px}

.foot{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);font-size:12.5px;color:var(--faint)}
.foot code{font-family:var(--mono)}

@media (max-width:720px){
  .cols{grid-template-columns:1fr}
  h1{font-size:25px}
  .hint{display:none}
}
.card.hide{display:none}
.bucket.hide{display:none}
</style>

<div class="wrap">
  <header class="top">
    <p class="eyebrow">Common Notes · rerun audit</p>
    <h1>Zvi notes, re-run through the new fact-check input</h1>
    <p class="lede">All 29 notes on <strong>Zvi's Substack</strong> re-checked with the input from commit <code>57cb0b6</code> — the search step now reads the <em>verbatim highlighted claim</em> + surrounding paragraph instead of Opus's paraphrase. Each note is bucketed by how its rerun compares to what's live in prod, so you can decide what to delete or replace. Nothing was written back to prod.</p>
  </header>

  <div class="summary" role="group" aria-label="Filter by bucket">
    <button class="stat all" data-filter="all" aria-pressed="true"><span class="num">${entries.length}</span><span class="lbl">all notes</span></button>
    <button class="stat no_note" data-filter="no_note" aria-pressed="false"><span class="num">${count("no_note")}</span><span class="lbl">no note now</span></button>
    <button class="stat different" data-filter="different" aria-pressed="false"><span class="num">${count("different")}</span><span class="lbl">different</span></button>
    <button class="stat same" data-filter="same" aria-pressed="false"><span class="num">${count("same")}</span><span class="lbl">same</span></button>
    <span class="hint">tap a count to filter</span>
  </div>

  ${sections}

  <p class="foot">Generated from <code>classified.json</code> · 29 claims, concurrency-4 rerun via the live <code>checkClaim</code> pipeline · same/different verdicts by Sonnet subagents · read-only against prod.</p>
</div>

<script>
const stats=[...document.querySelectorAll('.stat')];
const cards=[...document.querySelectorAll('.card')];
const secs=[...document.querySelectorAll('.bucket')];
function apply(f){
  stats.forEach(s=>s.setAttribute('aria-pressed', s.dataset.filter===f));
  cards.forEach(c=>c.classList.toggle('hide', f!=='all' && c.dataset.bucket!==f));
  secs.forEach(s=>s.classList.toggle('hide', f!=='all' && s.dataset.bucket!==f));
}
stats.forEach(s=>s.addEventListener('click',()=>apply(s.dataset.filter)));
</script>
`;

fs.writeFileSync(path.join(DIR, "overview.html"), html);
console.log(`overview.html written (${entries.length} entries)`);
