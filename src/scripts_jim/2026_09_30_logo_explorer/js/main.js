/* The logo explorer: five logo candidates, a panel of sliders for the one that
 * is selected, and previews of how each looks where it will be used. */

import { renderControls } from "./controls.js";
import { element, segments } from "./dom.js";
import { CANDIDATES, composeSvg, fitPlacement } from "./logos.js";
import { contexts, loadMocks } from "./previews.js";

const STORAGE_KEY = "cn-logo-explorer:v1";
// Raised when a candidate's defaults change so much that values stored by an
// older version would hide the change. Version 2 made the stacked notes the
// shipped logo (GOO-299), so values stored before it are dropped for that one
// candidate.
const STATE_VERSION = 2;
const RESET_BY_VERSION_2 = "stacked-notes";
// The Chrome Web Store asks for the artwork of the 128 pixel icon to be 96
// pixels wide inside a transparent margin. The icon that ships today does so.
const STORE_ARTWORK_SHARE = 96 / 128;
// The four icon files the extension ships, and the size the store's listing
// scales the largest of them to.
const ICON_FILES = [
  { pixels: 128, variant: "store", caption: "Store icon file, 128" },
  { pixels: 48, variant: "plain", caption: "Extensions page, 48" },
  { pixels: 32, variant: "plain", caption: "Toolbar on a sharp screen, 32" },
  { pixels: 16, variant: "plain", caption: "Toolbar and tab, 16" },
];
const STORE_LISTING_SIZE = { pixels: 60, variant: "store", caption: "As the store listing shows it, 60" };
const SHOWN_SIZES = [ICON_FILES[0], STORE_LISTING_SIZE, ...ICON_FILES.slice(1)];
const ZOOMED_SIZES = [16, 32];
const ZOOM_DISPLAY_PIXELS = 160;
const STAGE_BACKGROUNDS = [
  ["white", "White"],
  ["grey", "Light grey"],
  ["dark", "Dark"],
  ["checker", "Checkerboard"],
];
const VIEWS = [
  ["design", "Design"],
  ["context", "In context"],
  ["compare", "Compare all five"],
];

const byId = (id) => document.getElementById(id);
const candidateById = (id) => CANDIDATES.find((candidate) => candidate.id === id);

// ---------------------------------------------------------------------------
// State. It lives in this browser's storage, so a reload keeps the sliders.
// ---------------------------------------------------------------------------

function readStoredState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    // A private window or blocked storage: start from the defaults.
    return {};
  }
}

function initialState() {
  const stored = readStoredState();
  if (stored.values && stored.version !== STATE_VERSION) delete stored.values[RESET_BY_VERSION_2];
  return {
    selected: candidateById(stored.selected) ? stored.selected : CANDIDATES[0].id,
    view: VIEWS.some(([view]) => view === stored.view) ? stored.view : "design",
    stageBackground: stored.stageBackground ?? "white",
    showGuides: stored.showGuides ?? false,
    storeMargin: stored.storeMargin ?? true,
    version: STATE_VERSION,
    // Stored values go on top of the defaults, so a control added later
    // still gets its default.
    values: Object.fromEntries(CANDIDATES.map((candidate) => [candidate.id, { ...candidate.defaults, ...stored.values?.[candidate.id] }])),
  };
}

const state = initialState();
const svgs = {};
let applyVisibilityRules = () => {};

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage is a convenience. Without it the page works, it just forgets.
  }
}

const selectedCandidate = () => candidateById(state.selected);
const selectedValues = () => state.values[state.selected];

function setStatus(text) {
  byId("status").textContent = text;
}

// ---------------------------------------------------------------------------
// Drawing.
// ---------------------------------------------------------------------------

const dataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Draws one candidate in its three forms: as it is, as the store icon, and
 *  with its construction lines. */
function drawCandidate(candidate) {
  const values = state.values[candidate.id];
  const rendered = candidate.render(values);
  svgs[candidate.id] = {
    plain: composeSvg(rendered, values),
    store: composeSvg(rendered, values, { artworkShare: state.storeMargin ? STORE_ARTWORK_SHARE : 1 }),
    guides: composeSvg(rendered, values, { guides: true }),
  };
}

async function loadImage(svg) {
  const image = new Image();
  image.src = dataUrl(svg);
  await image.decode();
  return image;
}

/** An image of a candidate that follows the sliders. */
function logoImage(candidateId, pixels, variant = "plain") {
  const image = element("img", { className: "logo-image", alt: "", width: pixels, height: pixels, src: dataUrl(svgs[candidateId][variant]) });
  image.dataset.candidate = candidateId;
  image.dataset.variant = variant;
  return image;
}

function refreshImages(candidateId) {
  for (const image of document.querySelectorAll(`img[data-candidate="${candidateId}"]`)) {
    image.src = dataUrl(svgs[candidateId][image.dataset.variant]);
  }
}

function refreshStage() {
  const stage = byId("stage-art");
  if (stage) stage.innerHTML = svgs[state.selected][state.showGuides ? "guides" : "plain"];
}

/** Paints the icon into a canvas of exactly `pixels` by `pixels`. The canvas
 *  is shown enlarged with hard edges, so each square is one real pixel. */
async function refreshZooms() {
  const image = await loadImage(svgs[state.selected].plain);
  for (const canvas of document.querySelectorAll("canvas.zoom")) {
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  }
}

/** Redraws one candidate everywhere it is shown. A slider can be dragged into
 *  a shape the geometry library cannot build. That is reported in the status
 *  line and the last good drawing stays on screen. */
function redraw(candidateId) {
  try {
    drawCandidate(candidateById(candidateId));
  } catch (error) {
    setStatus(`These values could not be drawn: ${error.message}`);
    throw error;
  }
  refreshImages(candidateId);
  if (candidateId === state.selected) {
    refreshStage();
    refreshZooms();
  }
}

let redrawQueued = false;

/** Sliders fire faster than the screen refreshes, so redraws are bundled into
 *  one per frame. */
function queueRedraw() {
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    redraw(state.selected);
    persist();
  });
}

// ---------------------------------------------------------------------------
// The panel of controls on the right.
// ---------------------------------------------------------------------------

function setValues(patch) {
  Object.assign(selectedValues(), patch);
  redraw(state.selected);
  persist();
  renderPanel();
}

function renderPresets(candidate) {
  const buttons = candidate.presets.map((preset) => {
    const button = element("button", { type: "button", className: "chip", text: preset.name });
    button.addEventListener("click", () => setValues(preset.values));
    return button;
  });
  byId("presets").replaceChildren(...buttons);
  byId("presets-block").hidden = buttons.length === 0;
}

function renderPanel() {
  const candidate = selectedCandidate();
  byId("candidate-name").textContent = candidate.name;
  byId("candidate-summary").textContent = candidate.summary;
  renderPresets(candidate);
  applyVisibilityRules = renderControls(byId("controls"), candidate, selectedValues(), {
    onChange(key, value) {
      selectedValues()[key] = value;
      applyVisibilityRules(selectedValues());
      queueRedraw();
    },
    onReset: (key) => setValues({ [key]: candidate.defaults[key] }),
    onAction: (control) => setValues(control.run(selectedValues(), (id) => state.values[id])),
  });
}

// ---------------------------------------------------------------------------
// The list of candidates on the left.
// ---------------------------------------------------------------------------

function renderGallery() {
  const buttons = CANDIDATES.map((candidate, index) => {
    const button = element("button", { type: "button", className: "candidate" }, [
      element("span", { className: "candidate-swatches" }, [
        element("span", { className: "swatch swatch-light" }, [logoImage(candidate.id, 40)]),
        element("span", { className: "swatch swatch-dark" }, [logoImage(candidate.id, 40)]),
      ]),
      element("span", { className: "candidate-name", text: `${index + 1}. ${candidate.name}` }),
    ]);
    button.setAttribute("aria-pressed", String(candidate.id === state.selected));
    button.addEventListener("click", () => select(candidate.id));
    return button;
  });
  byId("gallery").replaceChildren(...buttons);
}

function select(candidateId) {
  state.selected = candidateId;
  persist();
  renderGallery();
  renderPanel();
  renderView();
}

// ---------------------------------------------------------------------------
// The three views in the middle.
// ---------------------------------------------------------------------------

function checkbox(label, checked, change) {
  const box = element("input", { type: "checkbox", checked });
  box.addEventListener("change", () => change(box.checked));
  return element("label", { className: "check" }, [box, label]);
}

const card = (title, headControls, body) =>
  element("section", { className: "card" }, [element("div", { className: "card-head" }, [element("h2", { text: title }), ...headControls]), ...body]);

function storeMarginCheckbox() {
  return checkbox("Store icon keeps Chrome's transparent margin", state.storeMargin, (checked) => {
    state.storeMargin = checked;
    for (const candidate of CANDIDATES) redraw(candidate.id);
    persist();
  });
}

function stageCard() {
  const stage = element("div", { className: "stage" }, [element("div", { id: "stage-art" })]);
  stage.dataset.background = state.stageBackground;
  const backgrounds = segments(STAGE_BACKGROUNDS, state.stageBackground, (value) => {
    state.stageBackground = value;
    stage.dataset.background = value;
    persist();
  });
  const guides = checkbox("Construction lines", state.showGuides, (checked) => {
    state.showGuides = checked;
    persist();
    refreshStage();
  });
  return card("Large", [backgrounds, guides], [stage]);
}

function sizeRow(theme) {
  const figures = SHOWN_SIZES.map(({ pixels, variant, caption }) =>
    element("figure", { className: "size" }, [logoImage(state.selected, pixels, variant), element("figcaption", { text: caption })]),
  );
  const row = element("div", { className: "sizes" }, figures);
  row.dataset.theme = theme;
  return row;
}

function zoomFigure(pixels, theme) {
  const canvas = element("canvas", { className: "zoom", width: pixels, height: pixels });
  canvas.style.width = `${ZOOM_DISPLAY_PIXELS}px`;
  canvas.style.height = `${ZOOM_DISPLAY_PIXELS}px`;
  const figure = element("figure", { className: "size" }, [canvas, element("figcaption", { text: `${pixels} by ${pixels} pixels` })]);
  figure.dataset.theme = theme;
  return figure;
}

function designView() {
  const zooms = ["light", "dark"].flatMap((theme) => ZOOMED_SIZES.map((pixels) => zoomFigure(pixels, theme)));
  return [
    stageCard(),
    card("At the sizes it ships", [storeMarginCheckbox()], [sizeRow("light"), sizeRow("dark")]),
    card(
      "The small icons, enlarged",
      [],
      [element("p", { className: "hint", text: "Each square is one pixel of the real icon. This is what survives of the shape at toolbar size." }), element("div", { className: "zooms" }, zooms)],
    ),
  ];
}

function contextFigure({ title, node, name }) {
  const frame = element("div", { className: `context-frame context-${name}` }, [node]);
  return element("figure", { className: "context" }, [element("figcaption", { text: title }), frame]);
}

const contextsOf = (candidateId) => contexts((pixels, variant) => logoImage(candidateId, pixels, variant));

function contextView() {
  return [card(`${selectedCandidate().name}, where it will be seen`, [storeMarginCheckbox()], contextsOf(state.selected).map(contextFigure))];
}

/** One card per place, with the five candidates side by side in it. Clicking
 *  a candidate selects it, so its sliders are one click away. */
function compareView() {
  const perCandidate = CANDIDATES.map((candidate) => contextsOf(candidate.id));
  return perCandidate[0].map((place, placeIndex) => {
    const cells = CANDIDATES.map((candidate, candidateIndex) => {
      const { node, name } = perCandidate[candidateIndex][placeIndex];
      const cell = contextFigure({ title: `${candidateIndex + 1}. ${candidate.name}`, node, name });
      cell.classList.toggle("context-selected", candidate.id === state.selected);
      cell.addEventListener("click", () => select(candidate.id));
      return cell;
    });
    return card(place.title, [], [element("div", { className: "compare-grid" }, cells)]);
  });
}

const VIEW_BUILDERS = { design: designView, context: contextView, compare: compareView };

function renderView() {
  const view = byId("view");
  view.dataset.view = state.view;
  view.replaceChildren(...VIEW_BUILDERS[state.view]());
  refreshStage();
  refreshZooms();
}

function renderTabs() {
  const tabs = segments(VIEWS, state.view, (view) => {
    state.view = view;
    persist();
    renderView();
  });
  byId("tabs").replaceChildren(tabs);
}

// ---------------------------------------------------------------------------
// Getting a logo out: the SVG, the PNG sizes, the slider values, a snapshot.
// ---------------------------------------------------------------------------

const settingsOf = (candidateId) => ({ candidate: candidateId, values: state.values[candidateId] });

function download(name, href) {
  element("a", { href, download: name }).click();
}

async function pngUrl(svg, pixels) {
  const canvas = element("canvas", { width: pixels, height: pixels });
  canvas.getContext("2d").drawImage(await loadImage(svg), 0, 0, pixels, pixels);
  return canvas.toDataURL("image/png");
}

async function downloadPngs() {
  const { plain, store } = svgs[state.selected];
  for (const { pixels, variant } of ICON_FILES) {
    download(`${state.selected}-${pixels}.png`, await pngUrl(variant === "store" ? store : plain, pixels));
  }
  setStatus("Downloaded the four icon sizes.");
}

function applySettings({ candidate, values }) {
  if (!candidateById(candidate)) throw new Error(`There is no candidate called "${candidate}".`);
  state.values[candidate] = { ...candidateById(candidate).defaults, ...values };
  redraw(candidate);
  select(candidate);
}

function pasteSettings() {
  const dialog = byId("paste-dialog");
  const text = byId("paste-text");
  text.value = "";
  dialog.showModal();
  dialog.addEventListener(
    "close",
    () => {
      if (dialog.returnValue !== "apply") return;
      try {
        applySettings(JSON.parse(text.value));
        setStatus("Settings applied.");
      } catch (error) {
        setStatus(`Those settings could not be read: ${error.message}`);
      }
    },
    { once: true },
  );
}

async function fetchSnapshots() {
  const response = await fetch("/api/snapshots");
  if (!response.ok) throw new Error(`Could not list the snapshots: HTTP ${response.status}`);
  return response.json();
}

async function renderSnapshots() {
  const snapshots = await fetchSnapshots();
  const buttons = snapshots.map((snapshot) => {
    const button = element("button", { type: "button", className: "snapshot" }, [
      element("img", { src: `snapshots/${snapshot.file}.svg`, alt: "", width: 28, height: 28 }),
      element("span", { text: snapshot.name || candidateById(snapshot.candidate)?.name || snapshot.candidate }),
    ]);
    button.title = `Saved ${new Date(snapshot.savedAt).toLocaleString()}. Click to load it into the sliders.`;
    button.addEventListener("click", () => {
      applySettings(snapshot);
      setStatus(`Loaded the snapshot "${snapshot.name}".`);
    });
    return button;
  });
  byId("snapshots").replaceChildren(...(buttons.length ? buttons : [element("p", { className: "hint", text: "Nothing saved yet." })]));
}

function saveSnapshot() {
  const dialog = byId("save-dialog");
  const name = byId("save-name");
  name.value = "";
  dialog.showModal();
  dialog.addEventListener(
    "close",
    async () => {
      if (dialog.returnValue !== "save") return;
      const response = await fetch("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.value.trim(), ...settingsOf(state.selected), svg: svgs[state.selected].plain }),
      });
      if (!response.ok) {
        setStatus(`The snapshot could not be saved: HTTP ${response.status}`);
        return;
      }
      const { file } = await response.json();
      setStatus(`Saved as snapshots/${file}.json`);
      renderSnapshots();
    },
    { once: true },
  );
}

const BUTTON_ACTIONS = {
  "copy-svg": async () => {
    await navigator.clipboard.writeText(svgs[state.selected].plain);
    setStatus("SVG copied.");
  },
  "download-svg": () => download(`${state.selected}.svg`, dataUrl(svgs[state.selected].plain)),
  "download-pngs": downloadPngs,
  "copy-settings": async () => {
    await navigator.clipboard.writeText(JSON.stringify(settingsOf(state.selected), null, 2));
    setStatus("Settings copied.");
  },
  "paste-settings": pasteSettings,
  "save-snapshot": saveSnapshot,
  fit: () => setValues(fitPlacement(selectedCandidate(), selectedValues())),
  "reset-all": () => setValues(selectedCandidate().defaults),
};

function wireButtons() {
  for (const button of document.querySelectorAll("[data-action]")) {
    button.addEventListener("click", () => BUTTON_ACTIONS[button.dataset.action]());
  }
}

// ---------------------------------------------------------------------------

await loadMocks();
for (const candidate of CANDIDATES) drawCandidate(candidate);
wireButtons();
renderTabs();
renderGallery();
renderPanel();
renderView();
renderSnapshots();
