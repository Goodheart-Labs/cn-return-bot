/* The places the logo will be seen: the Chrome Web Store listing, the website's
 * header, a browser window's tab and toolbar, and the right-click menu.
 *
 * The first two are static copies of the real pages' header markup, kept as
 * HTML fragments in mocks/. The browser window and the menu are drawn here,
 * since there is no page to copy them from. Every mock marks where the logo
 * goes with <span class="logo-slot" data-role="R" data-px="N">. N is the size
 * the real page shows the logo at. R names which of the logo's files goes
 * there: store, header, favicon, toolbar or menu. */

const BROWSER_WINDOW = `
<div class="mock-chrome">
  <div class="chrome-tabs">
    <span class="chrome-lights"><i></i><i></i><i></i></span>
    <div class="chrome-tab chrome-tab-active">
      <span class="logo-slot" data-role="favicon" data-px="16"></span>
      <span class="chrome-tab-title">Common Notes: Community Notes on everything</span>
      <svg class="chrome-icon" viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>
    </div>
    <div class="chrome-tab">
      <span class="chrome-globe"></span>
      <span class="chrome-tab-title">New Tab</span>
    </div>
  </div>
  <div class="chrome-bar">
    <svg class="chrome-icon" viewBox="0 0 20 20" width="18" height="18"><path d="M12 4l-6 6 6 6M6 10h10" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <svg class="chrome-icon chrome-dim" viewBox="0 0 20 20" width="18" height="18"><path d="M8 4l6 6-6 6M14 10H4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <svg class="chrome-icon" viewBox="0 0 20 20" width="18" height="18"><path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9M15.5 3.5v3h-3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div class="chrome-address">commonnotes.net/notes</div>
    <span class="chrome-extension" title="The extension's toolbar button"><span class="logo-slot" data-role="toolbar" data-px="16"></span></span>
    <span class="chrome-extension chrome-extension-hover" title="The same button under the mouse"><span class="logo-slot" data-role="toolbar" data-px="16"></span></span>
    <svg class="chrome-icon" viewBox="0 0 20 20" width="18" height="18"><path d="M8 3.5a1.75 1.75 0 0 1 3.5 0V5H15v3.5h1.2a1.8 1.8 0 0 1 0 3.6H15V16h-3.6v-1.2a1.75 1.75 0 0 0-3.5 0V16H4v-3.9h1.2a1.8 1.8 0 0 0 0-3.6H4V5h4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
    <span class="chrome-avatar"></span>
  </div>
</div>`;

/** Chrome on a Mac uses the system's menus. An extension with more than one
 *  entry for a selection gets one row with its name and icon, which opens a
 *  submenu with the entries. The menu is shown twice: as it opens, and with
 *  the pointer on our row, which macOS then fills with its accent blue. */
const menuRows = (pointed) => `
  <ul class="menu">
    <li>Copy</li>
    <li>Copy Link to Highlight</li>
    <li>Search Google for “opened in 1932”</li>
    <li>Print…</li>
    <li class="menu-separator"></li>
    <li class="menu-extension${pointed ? " menu-pointed" : ""}"><span class="logo-slot" data-role="menu" data-px="16"></span><span class="menu-label">Common Notes</span><span class="menu-arrow">›</span></li>
    <li class="menu-separator"></li>
    <li>Inspect</li>
  </ul>`;

const CONTEXT_MENU = `
<div class="mock-menu">
  <div class="menu-stack">${menuRows(false)}</div>
  <div class="menu-stack">${menuRows(true)}
    <ul class="menu menu-sub">
      <li>Write a Common Note on this</li>
      <li>Request Common Notes on this</li>
    </ul>
  </div>
</div>`;

const parse = (html) => new DOMParser().parseFromString(html, "text/html");

/** Reads a fragment, moves its style block into this page once, and returns
 *  the markup that is left. A missing fragment is an error: the explorer is
 *  not useful without its previews, so it should not quietly show less. */
async function loadFragment(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}: HTTP ${response.status}`);
  const fragment = parse(await response.text());
  const styles = [...fragment.querySelectorAll("style, link[rel=stylesheet]")];
  document.head.append(...styles);
  return { markup: fragment.body.innerHTML, hasDarkTheme: styles.some((style) => style.textContent.includes('[data-theme="dark"]')) };
}

let mocks;

export async function loadMocks() {
  const [store, site] = await Promise.all([loadFragment("mocks/store.html"), loadFragment("mocks/site.html")]);
  mocks = { store, site, chrome: { markup: BROWSER_WINDOW, hasDarkTheme: true }, menu: { markup: CONTEXT_MENU, hasDarkTheme: true } };
}

/** A mock with every logo slot filled by `makeLogo(pixels, role, theme)`. */
function mock(name, theme, makeLogo) {
  const root = parse(mocks[name].markup).body.firstElementChild;
  root.dataset.theme = theme;
  for (const slot of root.querySelectorAll(".logo-slot")) slot.replaceChildren(makeLogo(Number(slot.dataset.px), slot.dataset.role, theme));
  return document.adoptNode(root);
}

const PLACES = [
  ["store", "Chrome Web Store listing"],
  ["site", "Website header"],
  ["chrome", "Browser tab and toolbar"],
  ["menu", "Right-click menu on a selection"],
];

/** Every context the logo appears in, in light and dark. `makeLogo(pixels,
 *  role, theme)` builds the image for one slot. */
export function contexts(makeLogo) {
  const themes = (name) => (mocks[name].hasDarkTheme ? ["light", "dark"] : ["light"]);
  return PLACES.flatMap(([name, title]) => themes(name).map((theme) => ({ name, theme, title: `${title}, ${theme}`, node: mock(name, theme, makeLogo) })));
}
