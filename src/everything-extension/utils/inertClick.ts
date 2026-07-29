// "Did this click do something?" has no true oracle — the browser exposes no
// way to ask an element whether it has click listeners. Affordance signals
// are the proxy: interactive tags/roles, focusability, contenteditable, and
// computed cursor:pointer (the visual signal users read as clickable). A
// click with none of these anywhere in its path landed on empty surface.

const INTERACTIVE_TAGS = new Set([
  "A", "AUDIO", "BUTTON", "DETAILS", "EMBED", "IFRAME", "INPUT", "LABEL",
  "OPTION", "SELECT", "SUMMARY", "TEXTAREA", "VIDEO",
]);
const INTERACTIVE_ROLES = new Set([
  "button", "checkbox", "combobox", "link", "listbox", "menuitem",
  "menuitemcheckbox", "menuitemradio", "option", "radio", "searchbox",
  "slider", "spinbutton", "switch", "tab", "textbox",
]);

const ELEMENT_NODE = 1;

/** True when the click landed on empty surface — nothing in its path
 *  advertises interactivity. Used to decide whether an outside click should
 *  close an open note: clicks that do something (video play/pause, like,
 *  a link) keep it open. */
export function isInertClick(e: MouseEvent): boolean {
  for (const node of e.composedPath()) {
    const el = node as HTMLElement;
    if (el.nodeType !== ELEMENT_NODE) continue;
    if (INTERACTIVE_TAGS.has(el.tagName)) return false;
    const role = el.getAttribute("role");
    if (role && INTERACTIVE_ROLES.has(role.trim().toLowerCase())) return false;
    const tabindex = el.getAttribute("tabindex");
    if (tabindex !== null && Number(tabindex) >= 0) return false;
    if (el.isContentEditable) return false;
    if (getComputedStyle(el).cursor === "pointer") return false;
  }
  return true;
}

/** Whether the event passed through any of our shadow hosts
 *  (common-notes-ui / -inline / -yt / -requestnote) — events bubbling out of
 *  a shadow root retarget to the host, but composedPath keeps the hosts. */
export function insideCommonNotesUi(e: Event): boolean {
  return e.composedPath().some((n) => ((n as Element).tagName ?? "").startsWith("COMMON-NOTES"));
}
