/* The logo candidates.
 *
 * A candidate is a list of controls, their default values, some presets, and
 * a render function that turns the current values into SVG markup on a
 * 128 by 128 canvas. A candidate whose controls changed meaning has an
 * `upgrade` function, which turns values saved before the change into the
 * current ones. Values are stored flat under keys such as "a.rotation",
 * so a settings export is one readable object. */

import {
  CANVAS,
  bandAlong,
  bar,
  boundsOf,
  bubbleMatrix,
  bubbleShape,
  halfPlane,
  isEmptyShape,
  pathData,
  point,
  roundedRect,
  sideOf,
  splitLine,
} from "./geometry.js";

const BLUE = "#2563eb";
const GREEN = "#16a34a";
const AMBER = "#f5b301";
const RED = "#dc2626";
const INK = "#1f2937";
const WHITE = "#ffffff";

const range = (key, label, min, max, step = 1) => ({ type: "range", key, label, min, max, step });
const color = (key, label) => ({ type: "color", key, label });
const toggle = (key, label) => ({ type: "toggle", key, label });
const select = (key, label, options) => ({ type: "select", key, label, options });

/** The values stored under one prefix, as an object: group(values, "a") turns
 *  "a.rotation" into { rotation }. */
const group = (values, prefix) =>
  Object.fromEntries(
    Object.entries(values)
      .filter(([key]) => key.startsWith(`${prefix}.`))
      .map(([key, value]) => [key.slice(prefix.length + 1), value]),
  );

const prefixed = (prefix, values) => Object.fromEntries(Object.entries(values).map(([key, value]) => [`${prefix}.${key}`, value]));

const fillPath = (shape, fill) => (shape.isEmpty() ? "" : `<path d="${pathData(shape)}" fill="${fill}"/>`);
const outlinePath = (shape) =>
  `<path d="${pathData(shape)}" fill="none" stroke="#0f172a" stroke-opacity="0.55" stroke-width="0.6" stroke-dasharray="2 2"/>`;

// ---------------------------------------------------------------------------
// Controls every candidate shares: the tile behind the mark, and where the
// mark sits on the canvas.
// ---------------------------------------------------------------------------

const MAX_MARK_SCALE = 1.6;

const PLACEMENT_CONTROLS = {
  title: "Backdrop and placement",
  controls: [
    select("bg.shape", "Backdrop", [
      ["none", "None"],
      ["square", "Rounded square"],
      ["circle", "Circle"],
    ]),
    { ...color("bg.fill", "Backdrop colour"), visible: (values) => values["bg.shape"] !== "none" },
    { ...range("bg.radius", "Corner radius", 0, 64), visible: (values) => values["bg.shape"] === "square" },
    { ...range("bg.inset", "Inset from the edge", 0, 24, 0.5), visible: (values) => values["bg.shape"] !== "none" },
    { ...range("bg.strokeWidth", "Border width", 0, 20, 0.5), visible: (values) => values["bg.shape"] !== "none" },
    { ...color("bg.stroke", "Border colour"), visible: (values) => values["bg.shape"] !== "none" && values["bg.strokeWidth"] > 0 },
    range("art.scale", "Mark size", 0.3, MAX_MARK_SCALE, 0.01),
    range("art.x", "Mark shift X", -40, 40, 0.5),
    range("art.y", "Mark shift Y", -40, 40, 0.5),
  ],
};

const PLACEMENT_DEFAULTS = {
  "bg.shape": "none",
  "bg.fill": BLUE,
  "bg.radius": 28,
  "bg.inset": 0,
  "bg.strokeWidth": 0,
  "bg.stroke": BLUE,
  "art.scale": 1,
  "art.x": 0,
  "art.y": 0,
};

function backdropMarkup(values) {
  const shape = values["bg.shape"];
  if (shape === "none") return "";
  const inset = values["bg.inset"];
  const size = CANVAS - 2 * inset;
  const strokeWidth = values["bg.strokeWidth"];
  const stroke = strokeWidth > 0 ? ` stroke="${values["bg.stroke"]}" stroke-width="${strokeWidth}"` : "";
  if (shape === "circle") return `<circle cx="64" cy="64" r="${size / 2}" fill="${values["bg.fill"]}"${stroke}/>`;
  return `<rect x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${Math.min(values["bg.radius"], size / 2)}" fill="${values["bg.fill"]}"${stroke}/>`;
}

/** The mark is scaled around the middle of the canvas and then shifted. */
function placementTransform(values) {
  const scale = values["art.scale"];
  const x = values["art.x"];
  const y = values["art.y"];
  if (scale === 1 && x === 0 && y === 0) return "";
  const offset = (CANVAS / 2) * (1 - scale);
  const rounded = (value) => Math.round(value * 100) / 100;
  return `translate(${rounded(offset + x)} ${rounded(offset + y)}) scale(${scale})`;
}

/** The finished logo as one SVG document, from what a candidate's render
 *  function returned. With `guides` the construction
 *  lines are drawn on top. `artworkShare` below 1 shrinks the whole logo
 *  inside a transparent margin, which is how the Chrome Web Store wants its
 *  128 pixel icon: artwork at 96 pixels. */
export function composeSvg(rendered, values, { guides = false, artworkShare = 1 } = {}) {
  const transform = placementTransform(values);
  const inner = rendered.markup + (guides ? rendered.guides ?? "" : "");
  const art = transform ? `<g transform="${transform}">${inner}</g>` : inner;
  const view = CANVAS / artworkShare;
  const origin = (CANVAS - view) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="${origin} ${origin} ${view} ${view}">${backdropMarkup(values)}${art}</svg>`;
}

/** The placement values that centre the mark and make its longer side
 *  `span` units long. */
function placementFor(bounds, span) {
  const scale = span / Math.max(bounds.width, bounds.height);
  return {
    "art.scale": scale,
    "art.x": (CANVAS / 2 - bounds.center.x) * scale,
    "art.y": (CANVAS / 2 - bounds.center.y) * scale,
  };
}

/** The placement values that centre the mark and make its longer side fill
 *  the canvas up to a margin. The margin is wider on a backdrop, so the mark
 *  keeps some air around it. The values are rounded to the sliders' steps. */
export function fitPlacement(candidate, values) {
  const bounds = candidate.render(values).bounds;
  if (!bounds) return {};
  const margin = values["bg.shape"] === "none" ? 4 : 24;
  const placement = placementFor(bounds, Math.min(CANVAS - 2 * margin, MAX_MARK_SCALE * Math.max(bounds.width, bounds.height)));
  return {
    "art.scale": Math.round(placement["art.scale"] * 100) / 100,
    "art.x": Math.round(placement["art.x"] * 2) / 2,
    "art.y": Math.round(placement["art.y"] * 2) / 2,
  };
}

// How scripts/generate-logo-assets.ts (PR #532) turns a mark without a
// backdrop into the extension's icons. Alone, the mark fills the whole square,
// whatever the placement sliders say. In dark mode and in the right-click
// menu, where a plain mark can vanish, it sits on a tile and takes 80 of the
// tile's 128 units. The tile's corners are rounded by 22% of its width.
const TILE_MARK_SPAN = 80;
const TILE_RADIUS = 0.22 * CANVAS;
const DARK_TILE = "#000000";
const MENU_TILE = WHITE;

/** The logo's files as the extension and the website would ship them:
 *  `icon` alone, `storeIcon` inside the store's margin, `smallIcon` for the
 *  16 and 32 pixel places, and the mark on the dark mode tile and on the
 *  menu's tile.
 *  A candidate with its own backdrop ships as designed in every place, except
 *  that its `smallSizeValues`, if it has any, replace some of its values at
 *  the small sizes. That is how today's logo ships (PR #533): the website's
 *  thin logo, and a bolder version of it in the toolbar and the menu. A
 *  candidate with `noTiles` ships its plain icon where the others take a
 *  tile. */
export function shippedForms(candidate, rendered, values, storeArtworkShare) {
  if (values["bg.shape"] !== "none" || !rendered.bounds) {
    const asDesigned = composeSvg(rendered, values);
    const small = { ...values, ...candidate.smallSizeValues };
    const smallIcon = candidate.smallSizeValues ? composeSvg(candidate.render(small), small) : asDesigned;
    return { icon: asDesigned, storeIcon: composeSvg(rendered, values, { artworkShare: storeArtworkShare }), smallIcon, darkTile: smallIcon, menuTile: smallIcon };
  }
  const filled = { ...values, ...placementFor(rendered.bounds, CANVAS) };
  const icon = composeSvg(rendered, filled);
  const storeIcon = composeSvg(rendered, filled, { artworkShare: storeArtworkShare });
  if (candidate.noTiles) return { icon, storeIcon, smallIcon: icon, darkTile: icon, menuTile: icon };
  const onTile = (fill) =>
    composeSvg(rendered, {
      ...values,
      ...placementFor(rendered.bounds, TILE_MARK_SPAN),
      "bg.shape": "square",
      "bg.fill": fill,
      "bg.radius": TILE_RADIUS,
      "bg.inset": 0,
      "bg.strokeWidth": 0,
    });
  return { icon, storeIcon, smallIcon: icon, darkTile: onTile(DARK_TILE), menuTile: onTile(MENU_TILE) };
}

// ---------------------------------------------------------------------------
// The speech bubble, used by four candidates. Without its tail it is a
// rounded square.
// ---------------------------------------------------------------------------

const bodyControls = (prefix) => [
  color(`${prefix}.color`, "Colour"),
  range(`${prefix}.x`, "Position X", 0, 128, 0.5),
  range(`${prefix}.y`, "Position Y", 0, 128, 0.5),
  range(`${prefix}.rotation`, "Rotation", -180, 180, 1),
  range(`${prefix}.scale`, "Size", 0.3, 2, 0.01),
  range(`${prefix}.width`, "Body width", 20, 128, 0.5),
  range(`${prefix}.height`, "Body height", 20, 128, 0.5),
  range(`${prefix}.radius`, "Corner radius", 0, 64, 0.5),
];

const bubbleControls = (prefix) => [
  ...bodyControls(prefix),
  toggle(`${prefix}.flipH`, "Flip left to right"),
  toggle(`${prefix}.flipV`, "Flip top to bottom"),
  range(`${prefix}.tailPosition`, "Tail position along the edge", 0, 1, 0.01),
  range(`${prefix}.tailWidth`, "Tail width", 0, 60, 0.5),
  range(`${prefix}.tailLength`, "Tail length", 0, 50, 0.5),
  range(`${prefix}.tailLean`, "Tail lean", -1.5, 1.5, 0.01),
  range(`${prefix}.tailRound`, "Tail tip rounding", 0, 12, 0.25),
];

const BUBBLE = {
  x: 64,
  y: 56,
  rotation: 0,
  scale: 1,
  flipH: false,
  flipV: false,
  width: 100,
  height: 74,
  radius: 20,
  tailPosition: 0.26,
  tailWidth: 22,
  tailLength: 19,
  tailLean: -0.5,
  tailRound: 2.5,
  color: BLUE,
};

// ---------------------------------------------------------------------------
// 1. One bubble with stripes.
// ---------------------------------------------------------------------------

const STRIPE_PRESETS = [
  {
    name: "Slits from the right",
    values: { "stripe.mode": "cut", "stripe.angle": 0, "stripe.x": 0.8, "stripe.y": 0.38, "stripe.length": 58, "stripe.thickness": 7, "stripe.gap": 8, "stripe.roundEnds": true },
  },
  {
    name: "Across the corner",
    values: { "stripe.mode": "cut", "stripe.angle": 45, "stripe.x": 0.8, "stripe.y": 0.24, "stripe.length": 120, "stripe.thickness": 8, "stripe.gap": 7, "stripe.roundEnds": false },
  },
  {
    name: "Bars on top, like Substack",
    values: { "stripe.mode": "cut", "stripe.angle": 0, "stripe.x": 0.5, "stripe.y": 0.27, "stripe.length": 200, "stripe.thickness": 6, "stripe.gap": 9, "stripe.roundEnds": false },
  },
  {
    name: "Two lines of text",
    values: { "stripe.mode": "color", "stripe.colorA": WHITE, "stripe.colorB": WHITE, "stripe.angle": 0, "stripe.x": 0.64, "stripe.y": 0.36, "stripe.length": 44, "stripe.thickness": 8, "stripe.gap": 9, "stripe.roundEnds": true },
  },
  {
    name: "Green and red stripes",
    values: { "stripe.mode": "color", "stripe.colorA": "#4ade80", "stripe.colorB": "#f87171", "stripe.angle": 45, "stripe.x": 0.8, "stripe.y": 0.24, "stripe.length": 120, "stripe.thickness": 8, "stripe.gap": 5, "stripe.roundEnds": false },
  },
];

function renderStripedBubble(values) {
  const bubble = group(values, "bubble");
  const stripe = group(values, "stripe");
  const body = bubbleShape(bubble);
  // The stripes are laid out on the unplaced bubble and then placed with the
  // same matrix, so they turn, flip and grow with it.
  const center = point(-bubble.width / 2 + stripe.x * bubble.width, -bubble.height / 2 + stripe.y * bubble.height);
  const across = point(0, 1).rotate(stripe.angle);
  const pitch = stripe.thickness + stripe.gap;
  const bars = Array.from({ length: stripe.count }, (_, index) => {
    const barShape = bar(center.add(across.multiply((index - (stripe.count - 1) / 2) * pitch)), stripe.length, stripe.thickness, stripe.angle, stripe.roundEnds);
    barShape.transform(bubbleMatrix(bubble));
    return barShape;
  });
  if (stripe.mode === "cut") {
    const cut = bars.reduce((shape, barShape) => shape.subtract(barShape), body);
    return { markup: fillPath(cut, bubble.color), guides: bars.map(outlinePath).join(""), bounds: body.bounds };
  }
  const stripeColors = [stripe.colorA, stripe.colorB];
  const stripes = bars.map((barShape, index) => fillPath(barShape.intersect(body), stripeColors[index % 2]));
  return { markup: fillPath(body, bubble.color) + stripes.join(""), guides: bars.map(outlinePath).join(""), bounds: body.bounds };
}

const stripedBubble = {
  id: "striped-bubble",
  name: "Striped bubble",
  summary: "One message bubble with two stripes in its upper right corner.",
  presets: STRIPE_PRESETS,
  defaults: {
    ...prefixed("bubble", BUBBLE),
    "stripe.count": 2,
    "stripe.colorA": WHITE,
    "stripe.colorB": WHITE,
    ...STRIPE_PRESETS[0].values,
    ...PLACEMENT_DEFAULTS,
  },
  sections: [
    {
      title: "Stripes",
      controls: [
        select("stripe.mode", "Stripes are", [
          ["cut", "Cut out"],
          ["color", "Coloured"],
        ]),
        { ...color("stripe.colorA", "First stripe"), visible: (values) => values["stripe.mode"] === "color" },
        { ...color("stripe.colorB", "Second stripe"), visible: (values) => values["stripe.mode"] === "color" },
        range("stripe.count", "Number of stripes", 1, 4, 1),
        range("stripe.angle", "Angle", -90, 90, 1),
        range("stripe.x", "Position across the body", -0.2, 1.2, 0.01),
        range("stripe.y", "Position down the body", -0.2, 1.2, 0.01),
        range("stripe.length", "Length", 5, 200, 1),
        range("stripe.thickness", "Thickness", 1, 30, 0.5),
        range("stripe.gap", "Gap between stripes", 0, 30, 0.5),
        toggle("stripe.roundEnds", "Round ends"),
      ],
    },
    { title: "Bubble", controls: bubbleControls("bubble") },
    PLACEMENT_CONTROLS,
  ],
  render: renderStripedBubble,
};

// ---------------------------------------------------------------------------
// 2 and 3. Two bubbles that overlap.
// ---------------------------------------------------------------------------

// Colour sets for the candidates made of a green and a red shape. Each lists
// the first shape's colour, the second shape's and the overlap's. Green and red
// stay because they mean helpful and not helpful in the app, and the overlap
// sits between them like "somewhat helpful".
const BRIGHT_PALETTE = { name: "Bright, like Google's logo", colors: ["#34a853", "#ea4335", "#fbbc04"] };
const PAIR_PALETTES = [
  { name: "The app's rating colours", colors: [GREEN, RED, AMBER] },
  BRIGHT_PALETTE,
  { name: "Muted: sage, terracotta, mustard", colors: ["#5f9e6e", "#cf5c3c", "#e6b44c"] },
  { name: "Deep: emerald, crimson, gold", colors: ["#047857", "#be123c", "#f59e0b"] },
  { name: "Soft pastels", colors: ["#7fcf9a", "#f28b82", "#fdd663"] },
  { name: "Flat: emerald, alizarin, sunflower", colors: ["#2ecc71", "#e74c3c", "#f1c40f"] },
  // Okabe and Ito's palette, the standard set for charts that colour blind
  // readers must tell apart. Its green leans blue and its red leans orange,
  // and the two differ in lightness, so they stay apart without hue.
  { name: "Colour blind safe (Okabe and Ito)", colors: ["#009e73", "#d55e00", "#f0e442"] },
];

const PAIR_BUBBLE = { ...BUBBLE, width: 70, height: 54, radius: 17, tailWidth: 16, tailLength: 14, tailPosition: 0.17 };
const PAIR_DEFAULTS = {
  ...prefixed("a", { ...PAIR_BUBBLE, x: 49, y: 50, rotation: -9, color: GREEN }),
  ...prefixed("b", { ...PAIR_BUBBLE, x: 79, y: 67, rotation: 9, flipH: true, color: RED }),
};

const mirrorAcrossTheMiddle = (bubble) => ({ ...bubble, x: CANVAS - bubble.x, rotation: -bubble.rotation, flipH: !bubble.flipH });

const MIRROR_ACTION = {
  type: "action",
  label: "Make the second a mirror image of the first",
  run: (values) => prefixed("b", { ...mirrorAcrossTheMiddle(group(values, "a")), color: values["b.color"] }),
};

const swapColorsAction = (shapes) => ({
  type: "action",
  label: `Swap the two ${shapes}' colours`,
  run: (values) => ({ "a.color": values["b.color"], "b.color": values["a.color"] }),
});

const pairActions = (otherId, otherName) => [
  MIRROR_ACTION,
  swapColorsAction("bubbles"),
  {
    type: "action",
    label: `Copy both bubbles from "${otherName}"`,
    run: (_values, valuesOf) => ({ ...prefixed("a", group(valuesOf(otherId), "a")), ...prefixed("b", group(valuesOf(otherId), "b")) }),
  },
];

const pairGuides = (first, second) => outlinePath(first) + outlinePath(second);

/** Both bubbles are on the same level: neither lies on top. The overlap is
 *  split along a straight line, and each bubble's colour runs up to that line
 *  from its own side. */
function renderSplitPair(values) {
  const first = bubbleShape(group(values, "a"));
  const second = bubbleShape(group(values, "b"));
  const bounds = boundsOf([first, second]);
  const line = splitLine(first, second, values["split.tilt"], values["split.shift"]);
  if (!line) {
    return { markup: fillPath(first, values["a.color"]) + fillPath(second, values["b.color"]), guides: pairGuides(first, second), bounds };
  }
  const firstSide = sideOf(line, point(values["a.x"], values["a.y"])) * (values["split.swap"] ? -1 : 1);
  const firstShown = first.subtract(second.intersect(halfPlane(line, -firstSide)));
  const gap = values["split.gap"];
  let markup;
  if (gap > 0) {
    const gapInOverlap = bandAlong(line, gap).intersect(first.intersect(second));
    const secondShown = second.subtract(first.intersect(halfPlane(line, firstSide)));
    markup = fillPath(secondShown.subtract(gapInOverlap), values["b.color"]) + fillPath(firstShown.subtract(gapInOverlap), values["a.color"]);
  } else {
    // The second bubble is drawn whole and the first one's share on top of
    // it. Two shapes that merely touch along the line would let the page
    // show through as a hairline between them.
    markup = fillPath(second, values["b.color"]) + fillPath(firstShown, values["a.color"]);
  }
  const from = line.middle.subtract(line.direction.multiply(90));
  const to = line.middle.add(line.direction.multiply(90));
  const guides =
    pairGuides(first, second) +
    `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#0f172a" stroke-width="0.6"/>` +
    line.crossings.map((crossing) => `<circle cx="${crossing.x}" cy="${crossing.y}" r="1.6" fill="#ffffff" stroke="#0f172a" stroke-width="0.6"/>`).join("");
  return { markup, guides, bounds };
}

/** The overlap is a region of its own, in a third colour. */
function renderBlendPair(values) {
  const first = bubbleShape(group(values, "a"));
  const second = bubbleShape(group(values, "b"));
  const overlap = first.intersect(second);
  const markup =
    fillPath(first, values["a.color"]) + fillPath(second, values["b.color"]) + (isEmptyShape(overlap) ? "" : fillPath(overlap, values["overlap.color"]));
  return { markup, guides: pairGuides(first, second), bounds: boundsOf([first, second]) };
}

// Below this size a shrunk shape has vanished.
const VANISHED = 0.01;

/** A tailless bubble grown outwards by `distance` units on every side, or
 *  shrunk for a negative distance. A rounded rectangle grown by d is a rounded
 *  rectangle that is d wider on every side, with a corner radius d larger, so
 *  the result is exact. The distance is on the canvas, and the bubble's own
 *  units are scaled by its size slider. */
function grownBy(bubble, distance) {
  const local = distance / Math.abs(bubble.scale);
  return bubbleShape({
    ...bubble,
    width: Math.max(VANISHED, bubble.width + 2 * local),
    height: Math.max(VANISHED, bubble.height + 2 * local),
    radius: Math.max(0, bubble.radius + local),
  });
}

/** Two tailless shapes split into three regions: the first alone, the second
 *  alone, and their overlap. The regions keep a gap of `regions.gap` between
 *  them, half taken from each side. With `regions.outline` above zero, every
 *  region gets a line of that width along the inside of its edge. */
function renderTaillessPair(values) {
  const halfGap = values["regions.gap"] / 2;
  const outline = values["regions.outline"];
  // Without gaps or outlines the regions would touch, and anti-aliasing lets
  // the page show through as a hairline where they meet. Drawing the shapes on
  // top of each other avoids that.
  if (halfGap === 0 && outline === 0) return renderBlendPair(values);
  const first = group(values, "a");
  const second = group(values, "b");
  /** The three regions with every edge moved inwards by `inset`. */
  const regionsInset = (inset) => [
    [grownBy(first, -inset).subtract(grownBy(second, halfGap + inset)), values["a.color"]],
    [grownBy(second, -inset).subtract(grownBy(first, halfGap + inset)), values["b.color"]],
    [grownBy(first, -(halfGap + inset)).intersect(grownBy(second, -(halfGap + inset))), values["overlap.color"]],
  ];
  const regions = regionsInset(0);
  // The outline colour fills each region whole, and the region's colour is
  // drawn on top of it, moved in by the outline's width. The outline is drawn
  // as one shape, so no hairline shows where two regions meet without a gap.
  const outlineShape = outline > 0 ? regions.map(([shape]) => shape).reduce((all, shape) => all.unite(shape)) : null;
  const colored = outline > 0 ? regionsInset(outline) : regions;
  const markup = (outlineShape ? fillPath(outlineShape, values["regions.outlineColor"]) : "") + colored.map(([shape, fill]) => (isEmptyShape(shape) ? "" : fillPath(shape, fill))).join("");
  const firstShape = bubbleShape(first);
  const secondShape = bubbleShape(second);
  return { markup, guides: pairGuides(firstShape, secondShape), bounds: boundsOf([firstShape, secondShape]) };
}

const splitPair = {
  id: "split-pair",
  name: "Two bubbles, split along the chord",
  summary: "A green and a red bubble on the same level. Each colour runs through the overlap up to the line through the two points where the outlines cross.",
  presets: [],
  palettes: PAIR_PALETTES,
  defaults: { ...PAIR_DEFAULTS, "split.tilt": 0, "split.shift": 0, "split.gap": 0, "split.swap": false, ...PLACEMENT_DEFAULTS },
  sections: [
    {
      title: "The dividing line",
      controls: [
        range("split.gap", "Gap along the line", 0, 12, 0.25),
        range("split.tilt", "Turn the line", -90, 90, 1),
        range("split.shift", "Slide the line", -30, 30, 0.5),
        toggle("split.swap", "Give each bubble the far side"),
      ],
    },
    { title: "Both bubbles", controls: pairActions("blend-pair", "Two bubbles, yellow overlap") },
    { title: "First bubble", controls: bubbleControls("a") },
    { title: "Second bubble", controls: bubbleControls("b") },
    PLACEMENT_CONTROLS,
  ],
  render: renderSplitPair,
};

const blendPair = {
  id: "blend-pair",
  name: "Two bubbles, yellow overlap",
  summary: "The same two bubbles, with the area they share in yellow.",
  presets: [],
  palettes: PAIR_PALETTES,
  defaults: { ...PAIR_DEFAULTS, "overlap.color": AMBER, ...PLACEMENT_DEFAULTS },
  sections: [
    { title: "The overlap", controls: [color("overlap.color", "Overlap colour")] },
    { title: "Both bubbles", controls: pairActions("split-pair", "Two bubbles, split along the chord") },
    { title: "First bubble", controls: bubbleControls("a") },
    { title: "Second bubble", controls: bubbleControls("b") },
    PLACEMENT_CONTROLS,
  ],
  render: renderBlendPair,
};

// ---------------------------------------------------------------------------
// 4. Two stacked notes, the logo and the extension's note marker
// (NOTE_STACK_GLYPH_PATH in src/everything-ui/icons.tsx). The defaults are the
// proportions Jim picked for it (GOO-299), at the full size the mark has in
// that path's 24 unit grid: 96 of the 128 units here.
// ---------------------------------------------------------------------------

const DEFAULT_NOTES = {
  frontColor: BLUE,
  backColor: BLUE,
  lines: "cut",
  lineColor: WHITE,
  frontSize: 70.71,
  frontRadius: 14.45,
  // Jim made the back note smaller on 2026-10-02. The glyph that ships in
  // PR #532 still has a back note of 74.32.
  backSize: 67,
  backRadius: 11.87,
  shiftRight: 25.29,
  shiftUp: 25.29,
  gap: 10.32,
  innerCorner: "square",
  lineInset: 14.45,
  lineThickness: 15.48,
  line1Y: 24.77,
  line1Length: 40.77,
  line2Y: 48,
  line2Length: 25.81,
};

/** Where the front note's top right corner sits on the canvas when the mark
 *  is centred. Both notes are laid out from top right corners: the back
 *  note's corner is `shiftRight` and `shiftUp` away from the front note's. */
function centredFrontCorner(notes) {
  const left = Math.min(-notes.frontSize, notes.shiftRight - notes.backSize);
  const right = Math.max(0, notes.shiftRight);
  const top = Math.min(0, -notes.shiftUp);
  const bottom = Math.max(notes.frontSize, notes.backSize - notes.shiftUp);
  return { x: (CANVAS - (right - left)) / 2 - left, y: (CANVAS - (bottom - top)) / 2 - top };
}

// The front note's top right corner stays where the default mark puts it.
// So a size slider grows its note to the left and downwards, and a shift
// slider moves only the back note. "Fit to canvas" centres the mark again.
const FRONT_CORNER = centredFrontCorner(DEFAULT_NOTES);

function renderStackedNotes(values) {
  const notes = group(values, "notes");
  const frontX = FRONT_CORNER.x - notes.frontSize;
  const frontY = FRONT_CORNER.y;

  const front = roundedRect(frontX, frontY, notes.frontSize, notes.frontSize, notes.frontRadius);
  const back = roundedRect(FRONT_CORNER.x + notes.shiftRight - notes.backSize, frontY - notes.shiftUp, notes.backSize, notes.backSize, notes.backRadius);
  // The back note stops a gap's width before the front note, so the two read
  // as separate sheets at 16 pixels.
  const keepClear =
    notes.innerCorner === "round"
      ? roundedRect(frontX - notes.gap, frontY - notes.gap, notes.frontSize + 2 * notes.gap, notes.frontSize + 2 * notes.gap, notes.frontRadius + notes.gap)
      : roundedRect(frontX - 500, frontY - notes.gap, 500 + notes.frontSize + notes.gap, 500, 0);
  const backShown = back.subtract(keepClear);

  const lineAt = (y, length) => roundedRect(frontX + notes.lineInset, frontY + y - notes.lineThickness / 2, length, notes.lineThickness, notes.lineThickness / 2);
  const lines = [lineAt(notes.line1Y, notes.line1Length), lineAt(notes.line2Y, notes.line2Length)];
  const bounds = boundsOf([front, backShown]);
  if (notes.lines === "cut") {
    const frontWithLines = lines.reduce((shape, line) => shape.subtract(line), front);
    return { markup: fillPath(backShown, notes.backColor) + fillPath(frontWithLines, notes.frontColor), bounds };
  }
  const drawnLines = notes.lines === "color" ? lines.map((line) => fillPath(line, notes.lineColor)).join("") : "";
  return { markup: fillPath(backShown, notes.backColor) + fillPath(front, notes.frontColor) + drawnLines, bounds };
}

/** Values saved before 2026-10-02 measured the back note's shift from the
 *  front note's top left corner, as `offsetX` and `offsetY`. They are turned
 *  into the shift between the top right corners. That draws the same pair of
 *  notes, though not always at the same place on the canvas, since the old
 *  layout centred the mark after every change. */
function measureShiftsFromTopRightCorners(values) {
  if (!("notes.offsetX" in values)) return values;
  const { "notes.offsetX": offsetX, "notes.offsetY": offsetY, ...rest } = values;
  const shiftRight = offsetX + values["notes.backSize"] - values["notes.frontSize"];
  // Rounded to hundredths, so the sum's floating point noise stays out of the number box.
  return { ...rest, "notes.shiftRight": Math.round(shiftRight * 100) / 100, "notes.shiftUp": offsetY };
}

/** The marker glyph as it was before GOO-299, in the same units as the
 *  defaults. */
const OLD_MARKER_GEOMETRY = prefixed("notes", {
  frontSize: 68.5,
  frontRadius: 14,
  backSize: 72,
  backRadius: 11.5,
  shiftRight: 27.5,
  shiftUp: 27.5,
  gap: 16,
  lineInset: 14,
  lineThickness: 15,
  line1Y: 24,
  line1Length: 39.5,
  line2Y: 46.5,
  line2Length: 25,
});

const stackedNotes = {
  id: "stacked-notes",
  name: "Two stacked notes",
  summary: "The logo. The same mark is the extension's note marker, pin and badge.",
  presets: [
    { name: "The old marker, before GOO-299", values: OLD_MARKER_GEOMETRY },
    { name: "As in the app", values: { "bg.shape": "none", "notes.frontColor": BLUE, "notes.backColor": BLUE, "notes.lines": "cut", "art.scale": 1 } },
    // The extension's icon since GOO-299: the notes fill 80 of the tile's 128
    // units, as "Fit to canvas" leaves them on a backdrop. That is
    // scripts/generate-logo-assets.ts's MARK_SHARE_OF_TILE.
    { name: "White on a blue tile", values: { "bg.shape": "square", "bg.fill": BLUE, "bg.strokeWidth": 0, "bg.inset": 0, "bg.radius": 28, "notes.frontColor": WHITE, "notes.backColor": WHITE, "notes.lines": "cut", "art.scale": 0.83, "art.x": 0, "art.y": 0 } },
    // The dark mode icon since GOO-299: the blue notes on a black tile, at
    // the same proportions as the white-on-blue tile above.
    { name: "Blue on a black tile, the dark mode icon", values: { "bg.shape": "square", "bg.fill": "#000000", "bg.strokeWidth": 0, "bg.inset": 0, "bg.radius": 28, "notes.frontColor": BLUE, "notes.backColor": BLUE, "notes.lines": "cut", "art.scale": 0.83, "art.x": 0, "art.y": 0 } },
    { name: "Green in front of red", values: { "bg.shape": "none", "notes.frontColor": GREEN, "notes.backColor": RED, "notes.lines": "cut", "art.scale": 1 } },
  ],
  defaults: { ...prefixed("notes", DEFAULT_NOTES), ...PLACEMENT_DEFAULTS },
  upgrade: measureShiftsFromTopRightCorners,
  sections: [
    {
      title: "Notes",
      controls: [
        color("notes.frontColor", "Front note"),
        color("notes.backColor", "Back note"),
        range("notes.frontSize", "Front note size", 30, 110, 0.5),
        range("notes.frontRadius", "Front note corners", 0, 40, 0.5),
        range("notes.backSize", "Back note size", 30, 110, 0.5),
        range("notes.backRadius", "Back note corners", 0, 40, 0.5),
        range("notes.shiftRight", "Back note shift right", 0, 60, 0.5),
        range("notes.shiftUp", "Back note shift up", 0, 60, 0.5),
        range("notes.gap", "Gap between the notes", 0, 30, 0.5),
        select("notes.innerCorner", "Inner corner of the back note", [
          ["square", "Square"],
          ["round", "Round"],
        ]),
      ],
    },
    {
      title: "Text lines",
      controls: [
        select("notes.lines", "Lines are", [
          ["cut", "Cut out"],
          ["color", "Coloured"],
          ["none", "Absent"],
        ]),
        { ...color("notes.lineColor", "Line colour"), visible: (values) => values["notes.lines"] === "color" },
        range("notes.lineThickness", "Thickness", 2, 30, 0.5),
        range("notes.lineInset", "Inset from the left", 0, 40, 0.5),
        range("notes.line1Y", "First line, distance from the top", 0, 100, 0.5),
        range("notes.line1Length", "First line length", 5, 100, 0.5),
        range("notes.line2Y", "Second line, distance from the top", 0, 100, 0.5),
        range("notes.line2Length", "Second line length", 5, 100, 0.5),
      ],
    },
    PLACEMENT_CONTROLS,
  ],
  render: renderStackedNotes,
};

// ---------------------------------------------------------------------------
// 5. The logo that ships today: a note card with two text lines and the three
// rating boxes. The defaults redraw the website's logo
// (src/everything-ui/assets/logo.svg) with the boxes in the order green,
// yellow, red. PR #533 draws the extension's icons from that file too.
// Before, the extension had a bolder variant of its own.
// ---------------------------------------------------------------------------

/** The ratings name the colour values: "helpful" reads card.helpfulStroke and
 *  card.helpfulFill. */
const BOX_ORDERS = {
  "green-first": ["helpful", "somewhat", "not"],
  "red-first": ["not", "somewhat", "helpful"],
};

function renderNoteCard(values) {
  const card = group(values, "card");
  const textLine = (y, length) =>
    `<line x1="${card.lineLeft}" y1="${y}" x2="${card.lineLeft + length}" y2="${y}" stroke="${card.lineColor}" stroke-width="${card.lineThickness}" stroke-linecap="round"/>`;
  const boxes = BOX_ORDERS[card.boxOrder].map((rating, index) => {
    const stroke = values[`card.${rating}Stroke`];
    const fill = card.boxStyle === "solid" ? stroke : values[`card.${rating}Fill`];
    return `<rect x="${card.boxLeft + index * card.boxPitch}" y="${card.boxTop}" width="${card.boxWidth}" height="${card.boxHeight}" rx="${card.boxRadius}" fill="${fill}" stroke="${stroke}" stroke-width="${card.boxBorder}"/>`;
  });
  return { markup: textLine(card.line1Y, card.line1Length) + textLine(card.line2Y, card.line2Length) + boxes.join(""), bounds: null };
}

const BOLD_EXTENSION_ICON = {
  "bg.shape": "square",
  "bg.fill": "#aecdf3",
  "bg.stroke": BLUE,
  "bg.strokeWidth": 11,
  "bg.inset": 6,
  "bg.radius": 24,
  "card.lineLeft": 28,
  "card.lineThickness": 13,
  "card.line1Y": 38,
  "card.line1Length": 72,
  "card.line2Y": 62,
  "card.line2Length": 54,
  "card.boxLeft": 19,
  "card.boxPitch": 33,
  "card.boxTop": 83,
  "card.boxWidth": 24,
  "card.boxHeight": 20,
  "card.boxRadius": 5,
  "card.boxBorder": 9,
  "card.boxStyle": "outlined",
};

const WEBSITE_LOGO = {
  ...BOLD_EXTENSION_ICON,
  "bg.strokeWidth": 6,
  "bg.inset": 4,
  "card.lineLeft": 26,
  "card.lineThickness": 8,
  "card.line1Y": 40,
  "card.line1Length": 76,
  "card.line2Length": 60,
  "card.boxLeft": 24,
  "card.boxPitch": 28,
  "card.boxTop": 82,
  "card.boxHeight": 18,
  "card.boxRadius": 6,
  "card.boxBorder": 4,
};

const noteCard = {
  id: "note-card",
  name: "Today's logo, green first",
  summary: "The website's logo, with the rating boxes in the order green, yellow, red. With PR #533 the extension uses it too, but in the toolbar and the menu it keeps its old bold icon.",
  // The sliders shape the website's logo. The toolbar, the tab and the menu
  // show the bold icon's lines and borders instead, in the sliders' colours.
  smallSizeValues: BOLD_EXTENSION_ICON,
  presets: [
    { name: "The website's logo", values: WEBSITE_LOGO },
    { name: "The extension's old bold icon", values: BOLD_EXTENSION_ICON },
    { name: "Solid boxes", values: { ...BOLD_EXTENSION_ICON, "card.boxStyle": "solid", "card.boxBorder": 7, "card.boxLeft": 18, "card.boxWidth": 26, "card.boxHeight": 22, "card.boxTop": 82, "card.boxRadius": 6 } },
  ],
  defaults: {
    ...PLACEMENT_DEFAULTS,
    ...WEBSITE_LOGO,
    "card.lineColor": INK,
    "card.boxOrder": "green-first",
    "card.helpfulStroke": "#16a34a",
    "card.helpfulFill": "#bbf7d0",
    "card.somewhatStroke": "#d97706",
    "card.somewhatFill": "#fde68a",
    "card.notStroke": "#dc2626",
    "card.notFill": "#fecaca",
  },
  sections: [
    {
      title: "Rating boxes",
      controls: [
        select("card.boxOrder", "Order", [
          ["green-first", "Green, yellow, red"],
          ["red-first", "Red, yellow, green"],
        ]),
        select("card.boxStyle", "Style", [
          ["outlined", "Light with a border"],
          ["solid", "Solid"],
        ]),
        range("card.boxLeft", "Left edge of the first box", 0, 60, 0.5),
        range("card.boxPitch", "Distance from box to box", 10, 50, 0.5),
        range("card.boxTop", "Top edge", 40, 110, 0.5),
        range("card.boxWidth", "Width", 6, 40, 0.5),
        range("card.boxHeight", "Height", 6, 40, 0.5),
        range("card.boxRadius", "Corner radius", 0, 20, 0.5),
        range("card.boxBorder", "Border width", 0, 14, 0.5),
        color("card.helpfulStroke", "Green border"),
        { ...color("card.helpfulFill", "Green inside"), visible: (values) => values["card.boxStyle"] === "outlined" },
        color("card.somewhatStroke", "Yellow border"),
        { ...color("card.somewhatFill", "Yellow inside"), visible: (values) => values["card.boxStyle"] === "outlined" },
        color("card.notStroke", "Red border"),
        { ...color("card.notFill", "Red inside"), visible: (values) => values["card.boxStyle"] === "outlined" },
      ],
    },
    {
      title: "Text lines",
      controls: [
        color("card.lineColor", "Colour"),
        range("card.lineThickness", "Thickness", 2, 24, 0.5),
        range("card.lineLeft", "Left end", 10, 60, 0.5),
        range("card.line1Y", "First line height", 20, 70, 0.5),
        range("card.line1Length", "First line length", 10, 90, 0.5),
        range("card.line2Y", "Second line height", 30, 90, 0.5),
        range("card.line2Length", "Second line length", 10, 90, 0.5),
      ],
    },
    PLACEMENT_CONTROLS,
  ],
  render: renderNoteCard,
};

// ---------------------------------------------------------------------------
// 6 and 7. Two rounded squares or rectangles with a yellow overlap: the
// bubbles of candidate 3 without their tails. Jim wants these without the dark
// mode and menu tiles, so they ship as the plain mark everywhere.
// ---------------------------------------------------------------------------

/** A green and a red shape without tails, with a yellow overlap. `shape`
 *  names it in the panel: "square" or "rectangle". */
function overlapPair({ id, name, summary, shape, body, a, b, presets = [] }) {
  const tailless = { ...PAIR_BUBBLE, ...body, tailLength: 0, tailWidth: 0 };
  return {
    id,
    name,
    summary,
    presets,
    palettes: PAIR_PALETTES,
    noTiles: true,
    // The pair is wider than it is tall and covers little of its square, so
    // the store icon draws it 112 pixels wide, the Chrome Web Store guide's
    // size for a circle, rather than the 96 for a square.
    storeArtworkShare: 112 / 128,
    defaults: {
      ...prefixed("a", { ...tailless, ...a, color: GREEN }),
      ...prefixed("b", { ...tailless, ...b, color: RED }),
      "overlap.color": AMBER,
      "regions.gap": 0,
      "regions.outline": 0,
      "regions.outlineColor": "#000000",
      ...PLACEMENT_DEFAULTS,
    },
    sections: [
      { title: "The overlap", controls: [color("overlap.color", "Overlap colour")] },
      {
        title: "Gaps and outlines",
        controls: [
          range("regions.gap", "Gap between the colours", 0, 16, 0.25),
          range("regions.outline", "Outline inside each colour", 0, 16, 0.25),
          { ...color("regions.outlineColor", "Outline colour"), visible: (values) => values["regions.outline"] > 0 },
        ],
      },
      { title: `Both ${shape}s`, controls: [MIRROR_ACTION, swapColorsAction(`${shape}s`)] },
      { title: `First ${shape}`, controls: bodyControls("a") },
      { title: `Second ${shape}`, controls: bodyControls("b") },
      PLACEMENT_CONTROLS,
    ],
    render: renderTaillessPair,
  };
}

const squarePair = overlapPair({
  id: "square-pair",
  name: "Two squares, yellow overlap",
  summary: "Two rounded squares, green and red, with the area they share in yellow. It keeps its plain look in dark mode and in the menu.",
  shape: "square",
  body: { width: 60, height: 60, radius: 16 },
  a: { x: 52, y: 52, rotation: -9 },
  b: { x: 76, y: 70, rotation: 9 },
});

/** The logo Jim picked on 2026-10-02 (GOO-330): the two rectangles in the
 *  bright colour set, with a gap of 8 between the colours, the red rectangle
 *  a little lower, and both turned a little less, otherwise at their
 *  defaults. export-logos.ts
 *  draws src/everything-ui/assets/logo.svg from it. */
const [CHOSEN_GREEN, CHOSEN_RED, CHOSEN_YELLOW] = BRIGHT_PALETTE.colors;
export const CHOSEN_LOGO = {
  candidate: "rectangle-pair",
  values: { "regions.gap": 8, "b.y": 74, "a.rotation": -6, "b.rotation": 5, "a.color": CHOSEN_GREEN, "b.color": CHOSEN_RED, "overlap.color": CHOSEN_YELLOW },
};

const rectanglePair = overlapPair({
  id: "rectangle-pair",
  name: "Two rectangles, yellow overlap",
  summary: "Two rounded rectangles, green and red, with the area they share in yellow. It keeps its plain look in dark mode and in the menu.",
  shape: "rectangle",
  body: { width: 72, height: 50, radius: 15 },
  a: { x: 50, y: 52, rotation: -9 },
  b: { x: 78, y: 72, rotation: 9 },
  presets: [{ name: "The logo we picked (GOO-330)", values: CHOSEN_LOGO.values }],
});

// The bubbles, squares and rectangles are laid out by eye, so their defaults
// start fitted to the canvas. Otherwise they would be small next to the two
// marks that fill it.
for (const candidate of [stripedBubble, splitPair, blendPair, squarePair, rectanglePair]) Object.assign(candidate.defaults, fitPlacement(candidate, candidate.defaults));

export const CANDIDATES = [stripedBubble, splitPair, blendPair, stackedNotes, noteCard, squarePair, rectanglePair];
