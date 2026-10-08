import { quoteFragmentUrl } from "../dashboard-shared/textFragment";
import { esc, LINK, linkify, noteText, host } from "./markup";
import type { Article, Jim, ScoredNote, Staged } from "./types";

const STATUS = {
  helpful: { label: "Currently rated helpful", color: "#22c55e", box: "bg-blue-50 border-blue-100 dark:bg-blue-950/50 dark:border-blue-900",
    icon: `<path d="M5.5 10.5l3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` },
  not_helpful: { label: "Currently rated not helpful", color: "#ef4444", box: "bg-gray-100 border-gray-200 dark:bg-gray-800/60 dark:border-gray-700",
    icon: `<path d="M6.5 6.5l7 7M13.5 6.5l-7 7" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>` },
  needs_ratings: { label: "Needs more ratings", color: "#9ca3af", box: "bg-blue-50 border-blue-100 dark:bg-blue-950/50 dark:border-blue-900", icon: "" },
};
export const SHAPE = "inline-flex items-center gap-1 h-6 px-2 rounded-full border text-xs font-semibold transition-colors";
export const VOTE_STYLE: Record<"1" | "0" | "-1", { label: string; active: string; idle: string }> = {
  "1": { label: "Helpful", active: "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/50 dark:text-green-300 dark:border-green-700", idle: "text-green-700 border-gray-200 hover:bg-green-50 dark:text-green-400 dark:border-gray-600 dark:hover:bg-green-950/40" },
  "0": { label: "Somewhat helpful", active: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-700", idle: "text-amber-700 border-gray-200 hover:bg-amber-50 dark:text-amber-400 dark:border-gray-600 dark:hover:bg-amber-950/40" },
  "-1": { label: "Not helpful", active: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/50 dark:text-red-300 dark:border-red-700", idle: "text-red-700 border-gray-200 hover:bg-red-50 dark:text-red-400 dark:border-gray-600 dark:hover:bg-red-950/40" },
};
const pill = (noteId: string, v: "1" | "0" | "-1", count: number) =>
  `<button type="button" data-note="${noteId}" data-v="${v}" data-count="${count}" aria-pressed="false" class="${SHAPE} ${VOTE_STYLE[v].idle}">${VOTE_STYLE[v].label}<span>${count || ""}</span></button>`;
const CTX_CLASS = "cn-context text-xs text-gray-400 dark:text-gray-500 leading-relaxed";
const QUOTE_RAIL = "border-l-4 border-gray-300 dark:border-gray-600 pl-3";
const contextParagraph = (paragraph: string, quote: string, bare: boolean) => {
  const fullIdx = paragraph.toLowerCase().indexOf(quote.toLowerCase());
  const clampable = paragraph.length > 600;
  let text = paragraph, idx = fullIdx, ellipsis = false;
  if (clampable && fullIdx > 140) {
    const start = paragraph.lastIndexOf(" ", fullIdx - 120) + 1;
    text = paragraph.slice(start); idx = fullIdx - start; ellipsis = true;
  }
  const body = idx < 0 ? esc(text)
    : `${esc(text.slice(0, idx))}<strong class="font-semibold text-gray-800 dark:text-gray-200">${esc(text.slice(idx, idx + quote.length))}</strong>${esc(text.slice(idx + quote.length))}`;
  const full = fullIdx < 0 ? esc(paragraph)
    : `${esc(paragraph.slice(0, fullIdx))}<strong class="font-semibold text-gray-800 dark:text-gray-200">${esc(paragraph.slice(fullIdx, fullIdx + quote.length))}</strong>${esc(paragraph.slice(fullIdx + quote.length))}`;
  return `<div class="${CTX_CLASS} ${bare ? "" : QUOTE_RAIL}">
    <div class="ctx-body"${clampable ? ` style="display:-webkit-box;-webkit-line-clamp:7;-webkit-box-orient:vertical;overflow:hidden"` : ""}>${ellipsis ? "… " : ""}${body}</div>
    ${clampable ? `<template>${full}</template><button type="button" data-ctx-more class="mt-1 text-xs ${LINK}">Show more</button>` : ""}
  </div>`;
};

export function feedCards(jim: Map<string, Jim>, articles: Article[], helpfulAt: Map<string, string[]>, staging: Record<string, Staged>, newIds = new Set<string>(), popularity = new Map<string, { rank: number; readers: number }>()) {
  const articleOf = (id: string) => articles.find(a => a.ids.has(id))?.key;
  const thirdHelpful = (id: string) => helpfulAt.get(id)?.[2];
const card = (n: ScoredNote, i: number) => {
  const c = n.everything_claims, it = c?.everything_items, pr = it?.everything_projects, st = STATUS[n.status];
  const link = `https://commonnotes.net/?project=${pr?.slug}&note=${n.id}`;
  const paragraph = c?.context_paragraph, quote = c?.context_quote ?? c?.claim ?? "";
  const srcUrl = c?.context_url || it?.url || "";
  const deepLink = /youtube\.com|youtu\.be/.test(srcUrl) ? srcUrl : quoteFragmentUrl(srcUrl, c?.updated_quote ?? c?.context_quote ?? c?.claim ?? "");
  const j = jim.get(n.id);
  const jimTag = j ? [j.bucket === "send" ? "Jim: send" : j.bucket === "uncertain" ? "Jim: uncertain" : "", j.pick ? `Jim picked: ${j.pick}` : ""].filter(Boolean).join(" · ") : "";
  const art = articleOf(n.id);
  const third = thirdHelpful(n.id), sent = staging[n.id]?.status;
  const isNew = newIds.has(n.id), pop = pr?.slug ? popularity.get(pr.slug) : undefined;
  const newTag = isNew ? `new ${new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}${pop ? ` · ${pop.readers} reader${pop.readers === 1 ? "" : "s"}` : ""}` : "";
  const thirdTag = third ? `3rd helpful ${new Date(third).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "";
  return `<div id="note-${n.id}" data-card${j ? " data-jim" : ""}${art ? ` data-article="${art}"` : ""}${third ? ` data-third="${third}"` : ""}${isRecent(third) ? " data-recent" : ""}${isNew ? ` data-new data-pop="${pop?.rank ?? 99999}" data-created="${n.created_at}"` : ""} class="scroll-mt-4 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,40rem)_minmax(0,1fr)] xl:gap-4 items-start mb-6">
  ${paragraph ? `<div class="hidden xl:block xl:col-start-1 xl:row-start-1">${contextParagraph(paragraph, quote, false)}</div>
  <div class="xl:hidden w-full max-w-[40rem] mx-auto ctx-inline" style="display:grid;grid-template-rows:0fr;transition:grid-template-rows 300ms ease"><div class="overflow-hidden min-h-0"><div class="mb-2">${contextParagraph(paragraph, quote, true)}</div></div></div>` : ""}
  <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 w-full max-w-[40rem] mx-auto xl:max-w-none xl:mx-0 xl:col-start-2 xl:row-start-1">
  <div class="flex items-center justify-between gap-2 mb-2 text-xs text-gray-500 dark:text-gray-400">
    <span class="font-semibold text-gray-700 dark:text-gray-200"><input type="checkbox" data-select="${n.id}" style="margin-right:6px;vertical-align:-2px">#${i + 1} · ${esc(pr?.name)}${c?.updated_quote ? ` · <span class="text-green-700 dark:text-green-400">✎ since corrected</span>` : ""}${jimTag ? ` · <span class="text-amber-700 dark:text-amber-400">${esc(jimTag)}</span>` : ""}${newTag ? ` · <span class="text-blue-700 dark:text-blue-400">${esc(newTag)}</span>` : ""}${thirdTag ? ` · ${thirdTag}` : ""}${sent ? ` · <span class="text-green-700 dark:text-green-400">${sent === "sent" ? "sent to Typefully" : "staged"}</span>` : ""}</span>
    <a href="${link}" target="_blank" class="${LINK}">Open on Common Notes ↗</a>
  </div>
  ${j?.comment || j?.sendInstead ? `<div class="bg-gray-50 dark:bg-gray-800/40 rounded-lg border border-gray-200 dark:border-gray-700 p-3 mb-3 text-xs text-gray-600 dark:text-gray-300">
    ${j.comment ? `<p><strong class="font-semibold">Jim:</strong> ${esc(j.comment)}</p>` : ""}
    ${j.sendInstead ? `<p class="mt-2"><strong class="font-semibold">Jim's rewording:</strong> ${esc(j.sendInstead)}</p>` : ""}
  </div>` : ""}
  <div class="mb-3">${paragraph ? `<button type="button" data-ctx-toggle class="xl:hidden text-xs mb-2 ${LINK}">Show surrounding context</button>` : ""}<div class="bg-gray-50 dark:bg-gray-800/40 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
    <div class="flex justify-between gap-2 mb-1"><span class="text-xs text-gray-500 dark:text-gray-400">${esc(it?.title)}${it?.published_at ? ` · ${new Date(it.published_at + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}</span>
      <a href="${esc(deepLink)}" target="_blank" rel="noopener noreferrer" class="text-xs ${LINK} shrink-0">${host(it?.url)} ↗</a></div>
    <blockquote class="border-l-4 border-gray-300 dark:border-gray-600 pl-3 text-gray-600 dark:text-gray-300 italic text-sm">“${esc(c?.context_quote ?? "")}”</blockquote>
    ${c?.updated_quote ? `<p class="mt-2 pl-3 text-xs text-green-700 dark:text-green-400">✎ The source has since been updated and now reads: <em>“${esc(c.updated_quote)}”</em></p>` : ""}
  </div></div>
  <div class="cn-notebox rounded-lg p-3 border ${st.box}">
    <div class="-mx-3 px-3 pb-2 mb-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2">
      <div class="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-200"><svg viewBox="0 0 20 20" width="1.05em" height="1.05em" class="shrink-0"><circle cx="10" cy="10" r="10" fill="${st.color}"/>${st.icon}</svg><span>${st.label}</span></div>
    </div>
    <p class="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap">${linkify(noteText(n))}</p>
    <div class="-mx-3 mt-3 px-3 pt-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between flex-wrap gap-x-4 gap-y-1">
      <span class="text-sm text-gray-600 dark:text-gray-300">${n.votes} vote${n.votes === 1 ? "" : "s"}</span>
      <span class="inline-flex items-center gap-1 flex-wrap">
        ${pill(n.id, "1", n.helpful_count)}
        ${pill(n.id, "0", n.somewhat_helpful_count)}
        ${pill(n.id, "-1", n.not_helpful_count)}
      </span>
    </div>
  </div>
  </div>
</div>`;
};

return { card, thirdHelpful };
}
export const RECENT_DAYS = 14;
export const isRecent = (t?: string) => !!t && Date.now() - Date.parse(t) < RECENT_DAYS * 864e5;
