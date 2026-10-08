import type { Staged } from "./types";

const pubLine = (d?: string | null) => {
  if (!d) return "Published: unknown";
  const days = Math.round((Date.now() - new Date(d + "T12:00:00").getTime()) / 86_400_000);
  return `Published ${new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · <b>${days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`}</b>`;
};
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
export const stagingPage = (items: Staged[]) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tweet Staging</title>
<style>
:root{--bg:#f4f4f5;--card:#fff;--ink:#18181b;--muted:#52525b;--line:#d4d4d8}
@media (prefers-color-scheme:dark){:root{--bg:#09090b;--card:#18181b;--ink:#f4f4f5;--muted:#a1a1aa;--line:#3f3f46}}
body{font:15px -apple-system,system-ui,sans-serif;background:var(--bg);margin:0;padding:24px 16px;color:var(--ink)}
.top{max-width:1500px;margin:0 auto 16px;display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(460px,100%),1fr));gap:20px;max-width:1500px;margin:auto}
.card{background:var(--card);border-radius:12px;padding:14px;box-shadow:0 1px 3px #0002}
.card.sent{opacity:.5}.card img{width:100%;border-radius:8px;border:1px solid var(--line)}
.meta{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px;font-weight:600}
.tag{background:#fef3c7;color:#92400e;border-radius:6px;padding:1px 8px;font-size:12px;font-weight:500}
textarea{width:100%;box-sizing:border-box;font:14px/1.4 -apple-system,system-ui,sans-serif;margin:8px 0 2px;padding:8px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--ink);field-sizing:content;min-height:8em}
textarea.warn{border-color:#dc2626}
button{font:inherit;border:0;border-radius:6px;padding:6px 12px;cursor:pointer}
.go{background:#16a34a;color:#fff}.rm{background:#e4e4e7;color:#18181b}
.small{font-size:13px;color:var(--muted)}
.pending{display:flex;align-items:center;justify-content:center;height:160px;border:1px dashed var(--line);border-radius:8px;color:var(--muted)}
a{color:#2563eb}
</style></head><body>
<div class="top"><h1 style="margin:0">Staging</h1>
<span class="small">${items.filter(i => i.status !== "sent").length} to send · ${items.filter(i => i.status === "sent").length} sent</span>
<button class="go" id="send">Send all to Typefully (next free queue slots)</button>
<a href="/">← back to feed</a>
<span class="small" id="msg"></span></div>
<div class="grid">
${items.map(s => `<div class="card ${s.status === "sent" ? "sent" : ""}" data-id="${s.id}">
<div class="small" style="margin-bottom:6px">${pubLine(s.published)}</div>
<div class="meta"><span>${esc(s.author)}</span>${s.jim ? `<span class="tag">${esc(s.jim)}</span>` : ""}</div>
${s.shot === "ready" ? `<img src="/shots/${s.id}.png?v=1">` : `<div class="pending">${s.shot === "failed" ? "screenshot failed" : "taking screenshot…"}</div>`}
<textarea data-field="text" ${s.status === "sent" ? "readonly" : ""} class="${s.text.includes("@???") ? "warn" : ""}">${esc(s.text)}</textarea>
<div class="small"><span class="len">${s.text.length}</span> chars${s.text.includes("@???") ? " · <b style='color:#dc2626'>no handle — fill in the @</b>" : ""}</div>
<div class="small" style="margin-top:10px">↳ Reply (2nd tweet — leave empty for none)</div>
<textarea data-field="reply" ${s.status === "sent" ? "readonly" : ""} style="min-height:5em">${esc(s.reply ?? "")}</textarea>
<div style="margin-top:8px;display:flex;gap:8px;align-items:center">
<button class="rm copy-text">Copy text</button>${s.shot === "ready" ? `<button class="rm copy-img">Copy image</button>` : ""}
${s.status === "sent" ? `<span class="small">sent · draft ${esc(s.draft_id)}${s.scheduled ? ` · ${esc(s.scheduled)}` : ""}</span>` : `<select class="timing"><option value="slot"${s.timing !== "now" ? " selected" : ""}>Next free queue slot</option><option value="now"${s.timing === "now" ? " selected" : ""}>Post immediately</option></select><button class="rm">Remove</button><span class="small">${s.status === "error" ? "error: " + esc(s.error) : ""}</span>`}
</div></div>`).join("")}
</div>
<script>
const save = (t) => fetch("/api/staging/" + t.closest(".card").dataset.id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ [t.dataset.field]: t.value }) });
for (const t of document.querySelectorAll("textarea:not([readonly])")) {
  const card = t.closest(".card");
  if (t.dataset.field === "text") t.oninput = () => { card.querySelector(".len").textContent = t.value.length; t.classList.toggle("warn", t.value.includes("@???")); };
  t.onblur = () => save(t);
}
for (const sel of document.querySelectorAll("select.timing")) sel.onchange = () => {
  fetch("/api/staging/" + sel.closest(".card").dataset.id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ timing: sel.value }) });
  sel.closest(".card").style.outline = sel.value === "now" ? "2px solid #dc2626" : "";
};
const flash = (b, t) => { const o = b.textContent; b.textContent = t; setTimeout(() => b.textContent = o, 1200); };
for (const b of document.querySelectorAll(".copy-text")) b.onclick = async () => {
  await navigator.clipboard.writeText(b.closest(".card").querySelector('textarea[data-field="text"]').value); flash(b, "Copied ✓");
};
for (const b of document.querySelectorAll(".copy-img")) b.onclick = async () => {
  const png = fetch(b.closest(".card").querySelector("img").src).then(r => r.blob());
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]); flash(b, "Copied ✓");
};
for (const b of document.querySelectorAll(".rm:not(.copy-text):not(.copy-img)")) b.onclick = async () => {
  const card = b.closest(".card"); await fetch("/api/staging/" + card.dataset.id, { method: "DELETE" }); card.remove();
};
document.getElementById("send").onclick = async (e) => {
  const n = document.querySelectorAll(".card:not(.sent)").length;
  if (document.querySelector("textarea.warn")) return alert("Some tweets still have @??? — fill in the handle first.");
  const now = [...document.querySelectorAll("select.timing")].filter(x => x.value === "now").length;
  if (!confirm("Send " + n + " to Typefully: " + (n - now) + " into the next free queue slots" + (now ? ", " + now + " POSTED IMMEDIATELY" : "") + ". (Typefully drafts can't be deleted via API — only in the app.)")) return;
  await Promise.all([...document.querySelectorAll("textarea:not([readonly])")].map(save));
  e.target.disabled = true; document.getElementById("msg").textContent = "sending…";
  const r = await fetch("/api/send", { method: "POST" });
  document.getElementById("msg").textContent = await r.text();
  setTimeout(() => location.reload(), 1500);
};
if (document.querySelector(".pending:not(:empty)") && [...document.querySelectorAll(".pending")].some(p => p.textContent.includes("taking"))) setTimeout(() => location.reload(), 3000);
</script></body></html>`;
