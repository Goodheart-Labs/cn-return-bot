import type { Note } from "./types";

export const LINK = "text-blue-600 dark:text-blue-400 hover:underline";
export const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
export const linkify = (text: string) => esc(text).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer" class="${LINK} break-all">${u}</a>`);
export const noteText = (n: Note) => {
  const urls = [...new Set((n.sources ?? []).sort((a, b) => a.sort_order - b.sort_order).map((s) => s.url).filter(Boolean))];
  return urls.length ? `${n.note} ${urls.join(" ")}` : n.note;
};
export const host = (u?: string) => { try { return new URL(u!).hostname.replace(/^www\./, ""); } catch { return ""; } };
