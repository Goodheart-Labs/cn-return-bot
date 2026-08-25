// There is no way to answer "did this click do something?" for certain,
// because the browser will not tell you whether an element has click
// listeners. So we look for the signs that an element is meant to be
// interactive instead. Those signs are an interactive tag or role, being
// focusable, being contenteditable, and a computed cursor of `pointer`, which
// is the visual signal a user reads as clickable. A click with none of these
// anywhere in its path landed on empty surface.

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

/** True when the click landed on empty surface, meaning nothing in its path
 *  advertises itself as interactive. This decides whether a click outside an
 *  open note should close it. A click that does something, such as playing or
 *  pausing the video, pressing like, or following a link, keeps the note
 *  open. */
export function isInertClick(e: MouseEvent): boolean {
  let deepest: HTMLElement | null = null;
  for (const node of e.composedPath()) {
    // A press that went through any shadow root is a press on somebody's
    // interface, never on empty page surface. Another extension's toolbar
    // lives in its own shadow root, and without this rule a click in it read
    // as blank page and closed our note.
    if (node instanceof ShadowRoot) return false;
    const el = node as HTMLElement;
    if (el.nodeType !== ELEMENT_NODE) continue;
    deepest ??= el;
    if (INTERACTIVE_TAGS.has(el.tagName)) return false;
    const role = el.getAttribute("role");
    if (role && INTERACTIVE_ROLES.has(role.trim().toLowerCase())) return false;
    const tabindex = el.getAttribute("tabindex");
    if (tabindex !== null && Number(tabindex) >= 0) return false;
    if (el.isContentEditable) return false;
  }
  // The cursor inherits, so the deepest element's computed cursor answers for
  // the whole path. Reading it once keeps this handler cheap; the old
  // per-ancestor read ran style resolution on every click on the page.
  return !deepest || getComputedStyle(deepest).cursor !== "pointer";
}

/** Whether the event passed through one of our own shadow hosts. Those are
 *  common-notes-ui, common-notes-inline, and common-notes-yt. An event
 *  bubbling out of a shadow root is retargeted to its host, but composedPath
 *  still lists the hosts. */
export function insideCommonNotesUi(e: Event): boolean {
  return e.composedPath().some((n) => ((n as Element).tagName ?? "").startsWith("COMMON-NOTES"));
}
