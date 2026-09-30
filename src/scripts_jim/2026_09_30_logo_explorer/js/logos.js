/* The five logo candidates.
 *
 * A candidate is a list of controls, their default values, some presets, and
 * a render function that turns the current values into SVG markup on a
 * 128 by 128 canvas. Values are stored flat under keys such as "a.rotation",
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
    range("art.scale", "Mark size", 0.3, 1.6, 0.01),
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

/** The placement values that centre the mark and make its longer side fill
 *  the canvas up to a margin. The margin is wider on a backdrop, so the mark
 *  keeps some air around it. */
export function fitPlacement(candidate, values) {
  const bounds = candidate.render(values).bounds;
  if (!bounds) return {};
  const margin = values["bg.shape"] === "none" ? 4 : 24;
  const scale = (CANVAS - 2 * margin) / Math.max(bounds.width, bounds.height);
  return {
    "art.scale": Math.round(Math.min(1.6, scale) * 100) / 100,
    "art.x": Math.round((CANVAS / 2 - bounds.center.x) * scale * 2) / 2,
    "art.y": Math.round((CANVAS / 2 - bounds.center.y) * scale * 2) / 2,
  };
}

// ---------------------------------------------------------------------------
// The speech bubble, used by three candidates.
// ---------------------------------------------------------------------------

const bubbleControls = (prefix) => [
  color(`${prefix}.color`, "Colour"),
  range(`${prefix}.x`, "Position X", 0, 128, 0.5),
  range(`${prefix}.y`, "Position Y", 0, 128, 0.5),
  range(`${prefix}.rotation`, "Rotation", -180, 180, 1),
  range(`${prefix}.scale`, "Size", 0.3, 2, 0.01),
  toggle(`${prefix}.flipH`, "Flip left to right"),
  toggle(`${prefix}.flipV`, "Flip top to bottom"),
  range(`${prefix}.width`, "Body width", 20, 128, 0.5),
  range(`${prefix}.height`, "Body height", 20, 128, 0.5),
  range(`${prefix}.radius`, "Corner radius", 0, 64, 0.5),
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

const PAIR_BUBBLE = { ...BUBBLE, width: 70, height: 54, radius: 17, tailWidth: 16, tailLength: 14, tailPosition: 0.17 };
const PAIR_DEFAULTS = {
  ...prefixed("a", { ...PAIR_BUBBLE, x: 49, y: 50, rotation: -9, color: GREEN }),
  ...prefixed("b", { ...PAIR_BUBBLE, x: 79, y: 67, rotation: 9, flipH: true, color: RED }),
};

const mirrorAcrossTheMiddle = (bubble) => ({ ...bubble, x: CANVAS - bubble.x, rotation: -bubble.rotation, flipH: !bubble.flipH });

const pairActions = (otherId, otherName) => [
  {
    type: "action",
    label: "Make the second a mirror image of the first",
    run: (values) => prefixed("b", { ...mirrorAcrossTheMiddle(group(values, "a")), color: values["b.color"] }),
  },
  {
    type: "action",
    label: "Swap the two bubbles' colours",
    run: (values) => ({ "a.color": values["b.color"], "b.color": values["a.color"] }),
  },
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

const splitPair = {
  id: "split-pair",
  name: "Two bubbles, split along the chord",
  summary: "A green and a red bubble on the same level. Each colour runs through the overlap up to the line through the two points where the outlines cross.",
  presets: [],
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

function renderStackedNotes(values) {
  const notes = group(values, "notes");
  const spanX = Math.max(notes.frontSize, notes.offsetX + notes.backSize);
  const top = Math.min(0, -notes.offsetY);
  const spanY = Math.max(notes.frontSize, notes.backSize - notes.offsetY) - top;
  const frontX = (CANVAS - spanX) / 2;
  const frontY = (CANVAS - spanY) / 2 - top;

  const front = roundedRect(frontX, frontY, notes.frontSize, notes.frontSize, notes.frontRadius);
  const back = roundedRect(frontX + notes.offsetX, frontY - notes.offsetY, notes.backSize, notes.backSize, notes.backRadius);
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

/** The marker glyph as it was before GOO-299, in the same units as the
 *  defaults. */
const OLD_MARKER_GEOMETRY = prefixed("notes", {
  frontSize: 68.5,
  frontRadius: 14,
  backSize: 72,
  backRadius: 11.5,
  offsetX: 24,
  offsetY: 27.5,
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
    { name: "White on a blue tile", values: { "bg.shape": "square", "bg.fill": BLUE, "bg.strokeWidth": 0, "notes.frontColor": WHITE, "notes.backColor": WHITE, "notes.lines": "cut", "art.scale": 0.68 } },
    { name: "Green in front of red", values: { "bg.shape": "none", "notes.frontColor": GREEN, "notes.backColor": RED, "notes.lines": "cut", "art.scale": 1 } },
  ],
  defaults: {
    ...prefixed("notes", {
      frontColor: BLUE,
      backColor: BLUE,
      lines: "cut",
      lineColor: WHITE,
      frontSize: 70.71,
      frontRadius: 14.45,
      backSize: 74.32,
      backRadius: 11.87,
      offsetX: 21.68,
      offsetY: 25.29,
      gap: 10.32,
      innerCorner: "square",
      lineInset: 14.45,
      lineThickness: 15.48,
      line1Y: 24.77,
      line1Length: 40.77,
      line2Y: 48,
      line2Length: 25.81,
    }),
    ...PLACEMENT_DEFAULTS,
  },
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
        range("notes.offsetX", "Back note shift right", 0, 60, 0.5),
        range("notes.offsetY", "Back note shift up", 0, 60, 0.5),
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
// rating boxes. The defaults redraw the extension's icon
// (src/everything-extension/assets/icon-bold-midpills.svg) with the boxes in
// the order green, yellow, red.
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

const SHIPPED_ICON = {
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
  ...SHIPPED_ICON,
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
  summary: "The note card that ships today, with the rating boxes in the order green, yellow, red.",
  presets: [
    { name: "The extension's icon", values: SHIPPED_ICON },
    { name: "The website's thinner logo", values: WEBSITE_LOGO },
    { name: "Solid boxes", values: { ...SHIPPED_ICON, "card.boxStyle": "solid", "card.boxBorder": 7, "card.boxLeft": 18, "card.boxWidth": 26, "card.boxHeight": 22, "card.boxTop": 82, "card.boxRadius": 6 } },
  ],
  defaults: {
    ...PLACEMENT_DEFAULTS,
    ...SHIPPED_ICON,
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

// The bubbles are laid out by eye, so their defaults start fitted to the
// canvas. Otherwise they would be small next to the two marks that fill it.
for (const candidate of [stripedBubble, splitPair, blendPair]) Object.assign(candidate.defaults, fitPlacement(candidate, candidate.defaults));

export const CANDIDATES = [stripedBubble, splitPair, blendPair, stackedNotes, noteCard];
