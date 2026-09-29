import { esc, LINK } from "./markup";
import { feedCards, SHAPE, VOTE_STYLE, RECENT_DAYS, isRecent } from "./feedCards";
import type { Article, Jim, ScoredNote, Staged } from "./types";

export function feedPage(scored: ScoredNote[], jim: Map<string, Jim>, articles: Article[], helpfulAt: Map<string, string[]>, staging: Record<string, Staged>, URL_: string, ANON: string) {
  const open = scored.filter(n => !n.everything_claims?.updated_quote);
  const corrected = scored.filter(n => n.everything_claims?.updated_quote);
  const { card, thirdHelpful } = feedCards(jim, articles, helpfulAt, staging);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ranked Notes</title><link rel="stylesheet" href="feed.css">
<script>matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.classList.add("dark")</script>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
body[data-filter="jim"] [data-card]:not([data-jim]){display:none}
body[data-filter="recent"] [data-card]:not([data-recent]){display:none}
${articles.map(a => `body[data-filter="${a.key}"] [data-card]:not([data-article="${a.key}"]){display:none}`).join("\n")}
[data-filter-btn]{white-space:nowrap}
[data-filter-btn][aria-pressed="true"]{background:#2563eb;color:#fff;border-color:#2563eb}</style></head>
<body class="bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100 min-h-screen">
<main class="flex-1 min-w-0 max-w-3xl md:max-w-[96rem] mx-auto px-4 md:px-8 py-8 w-full">
  <div class="xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,40rem)_minmax(0,1fr)] xl:gap-4 mb-6"><div class="w-full max-w-[40rem] mx-auto xl:max-w-none xl:mx-0 xl:col-start-2">
    <h2 class="text-2xl font-extrabold min-w-0 break-words">Most helpful notes</h2>
    <div id="auth" class="flex items-center gap-4 mt-2 mb-2 text-sm text-gray-500 dark:text-gray-400">Loading sign-in…</div>
    <div id="toolbar" class="flex items-center flex-wrap gap-x-4 gap-y-1 mb-2 text-sm text-gray-600 dark:text-gray-300" style="position:sticky;top:0;z-index:10;padding:8px 0;background:inherit">
      <span class="inline-flex items-center gap-1">
        <button type="button" data-filter-btn="all" class="${SHAPE} border-gray-200 dark:border-gray-600">All</button>
        <button type="button" data-filter-btn="jim" class="${SHAPE} border-gray-200 dark:border-gray-600">Jim's list (${jim.size})</button>
        <button type="button" data-filter-btn="recent" title="Notes whose 3rd Helpful vote landed in the last ${RECENT_DAYS} days, newest first" class="${SHAPE} border-gray-200 dark:border-gray-600">Recent 3+ helpful (${open.filter(n => isRecent(thirdHelpful(n.id))).length})</button>
        ${articles.map(a => `<button type="button" data-filter-btn="${a.key}" title="${esc(a.title)}" class="${SHAPE} border-gray-200 dark:border-gray-600">${esc(a.title.length > 40 ? a.title.slice(0, 38) + "…" : a.title)} (${a.ids.size})</button>`).join("\n        ")}
      </span>
      <button type="button" id="select-shown" class="${LINK}">Select all shown</button>
      <button type="button" id="select-none" class="${LINK}">Clear</button>
      <button type="button" id="stage" class="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-40" disabled>Stage 0 →</button>
      <a href="/staging" class="${LINK}">Staging area</a>
    </div>
    <p class="text-sm text-gray-500 dark:text-gray-400">${open.length} notes (with votes, on Jim's list, or on an article in articles.json), across every project · ${corrected.length} since-corrected hidden (<button type="button" onclick="const c=document.getElementById('corrected');c.hidden=!c.hidden;this.textContent=c.hidden?'show':'hide'" class="${LINK}">show</button>) · ranked by the site's P(rated helpful), author's own vote removed · ${new Date().toLocaleString()}</p>
  </div></div>
  ${open.map(card).join("\n")}
  <div id="corrected" hidden>${corrected.map((n, i) => card(n, open.length + i)).join("\n")}</div>
</main>
<script type="module">
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const sb = createClient(${JSON.stringify(URL_)}, ${JSON.stringify(ANON)});
const STYLE = ${JSON.stringify(Object.fromEntries(Object.entries(VOTE_STYLE).map(([k, v]) => [k, { active: v.active, idle: v.idle }])))};
const SHAPE = ${JSON.stringify(SHAPE)};
const auth = document.getElementById("auth");
let user = null;
const mine = new Map();

function paint(noteId) {
  for (const b of document.querySelectorAll(\`button[data-note="\${noteId}"]\`)) {
    const on = mine.get(noteId) === b.dataset.v;
    b.className = SHAPE + " " + (on ? STYLE[b.dataset.v].active : STYLE[b.dataset.v].idle);
    b.setAttribute("aria-pressed", on);
    b.lastElementChild.textContent = +b.dataset.count || "";
  }
}
const bump = (noteId, v, d) => {
  const b = document.querySelector(\`button[data-note="\${noteId}"][data-v="\${v}"]\`);
  if (b) b.dataset.count = +b.dataset.count + d;
};

async function refresh() {
  if (location.protocol === "file:") {
    auth.innerHTML = '<a href="http://localhost:8003/" class="text-blue-600 dark:text-blue-400 hover:underline">Open localhost:8003 to vote</a> (sign-in cannot return to a file)';
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  user = session?.user ?? null;
  if (!user) {
    auth.innerHTML = '<button id="signin" class="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700">Sign in with X to vote</button>';
    document.getElementById("signin").onclick = () =>
      sb.auth.signInWithOAuth({ provider: "twitter", options: { redirectTo: location.origin + location.pathname } });
    return;
  }
  const name = user.user_metadata?.user_name || user.user_metadata?.preferred_username || user.email || "you";
  auth.innerHTML = \`<span>Voting as <strong class="font-semibold text-gray-800 dark:text-gray-200">@\${name}</strong></span><button id="signout" class="text-blue-600 dark:text-blue-400 hover:underline">Sign out</button>\`;
  document.getElementById("signout").onclick = async () => { await sb.auth.signOut(); location.reload(); };
  const { data, error } = await sb.from("everything_votes").select("note_id, vote").eq("voter_id", user.id);
  if (error) { auth.insertAdjacentHTML("beforeend", " · couldn't load your votes: " + error.message); return; }
  for (const r of data) { mine.set(r.note_id, String(r.vote)); paint(r.note_id); }
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-ctx-toggle]");
  if (t) {
    const inline = t.closest("[id^=note-]").querySelector(".ctx-inline");
    const open = inline.style.gridTemplateRows === "1fr";
    inline.style.gridTemplateRows = open ? "0fr" : "1fr";
    t.textContent = open ? "Show surrounding context" : "Hide surrounding context";
  }
  const m = e.target.closest("[data-ctx-more]");
  if (m) {
    const body = m.parentElement.querySelector(".ctx-body");
    body.innerHTML = m.previousElementSibling.innerHTML;
    body.removeAttribute("style");
    m.remove();
  }
});

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-note]");
  if (!b) return;
  if (!user) { auth.scrollIntoView({ behavior: "smooth" }); return; }
  const noteId = b.dataset.note, v = b.dataset.v, prev = mine.get(noteId);
  if (prev === v) {
    const { error } = await sb.from("everything_votes").delete().eq("note_id", noteId).eq("voter_id", user.id);
    if (error) return alert("Vote retract failed: " + error.message);
    mine.delete(noteId); bump(noteId, v, -1);
  } else {
    const { error } = await sb.from("everything_votes")
      .upsert({ note_id: noteId, voter_id: user.id, vote: +v, platform: "web" }, { onConflict: "note_id,voter_id" });
    if (error) return alert("Vote failed: " + error.message);
    if (prev !== undefined) bump(noteId, prev, -1);
    mine.set(noteId, v); bump(noteId, v, +1);
  }
  paint(noteId);
});
const cards = [...document.querySelectorAll("main > [data-card]")];
const setFilter = (f) => {
  document.body.dataset.filter = f;
  const order = f === "recent" ? [...cards].sort((a, b) => (b.dataset.third || "").localeCompare(a.dataset.third || "")) : cards;
  const corrected = document.getElementById("corrected");
  for (const c of order) corrected.before(c);
  for (const b of document.querySelectorAll("[data-filter-btn]")) b.setAttribute("aria-pressed", b.dataset.filterBtn === f);
  try { localStorage.setItem("feed-filter", f); } catch {}
};
let saved = new URLSearchParams(location.search).get("filter") || "all";
if (!location.search.includes("filter=")) try { saved = localStorage.getItem("feed-filter") || "all"; } catch {}
setFilter(saved);
for (const b of document.querySelectorAll("[data-filter-btn]")) b.onclick = () => setFilter(b.dataset.filterBtn);

const stageBtn = document.getElementById("stage");
const picked = () => [...document.querySelectorAll("input[data-select]:checked")].map(x => x.dataset.select);
const updateCount = () => { const n = picked().length; stageBtn.textContent = \`Stage \${n} →\`; stageBtn.disabled = !n; };
document.addEventListener("change", (e) => { if (e.target.matches("input[data-select]")) updateCount(); });
const shown = (el) => el.closest("[data-card]").offsetParent !== null;
document.getElementById("select-shown").onclick = () => { for (const x of document.querySelectorAll("input[data-select]")) if (shown(x)) x.checked = true; updateCount(); };
document.getElementById("select-none").onclick = () => { for (const x of document.querySelectorAll("input[data-select]")) x.checked = false; updateCount(); };
stageBtn.onclick = async () => {
  if (location.protocol === "file:") return alert("Open http://localhost:8003 to stage");
  stageBtn.disabled = true; stageBtn.textContent = "Staging…";
  const r = await fetch("/api/stage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: picked() }) });
  if (!r.ok) { alert("Stage failed: " + await r.text()); updateCount(); return; }
  location.href = "/staging";
};

sb.auth.onAuthStateChange((ev) => { if (ev !== "INITIAL_SESSION") refresh(); });
refresh();
</script></body></html>`;
return html;
}
