/* Shape construction for the logo explorer.
 *
 * Paper.js does the geometry. It is a vector graphics library whose "boolean
 * operations" (unite, intersect, subtract) work on curved outlines and return
 * a new outline. We never let it draw: every shape ends up as SVG path data,
 * so an exported logo consists of plain paths with no clipping or masking. */

const paper = window.paper;
paper.setup(new paper.Size(1, 1));
// Without this, every shape Paper.js creates is added to its invisible
// drawing and kept alive forever.
paper.settings.insertItems = false;

export const CANVAS = 128;
const FAR = 1000;

const round2 = (value) => Math.round(value * 100) / 100;

/** Paper.js writes coordinates with a dozen decimals. Two are plenty on a
 *  128 unit canvas and keep the exported file readable. */
export function pathData(item) {
  return item.pathData.replace(/-?\d*\.\d+(e-?\d+)?/g, (number) => String(round2(Number(number))));
}

export const isEmptyShape = (item) => item.isEmpty() || Math.abs(item.area) < 0.01;

export function roundedRect(x, y, width, height, radius) {
  return new paper.Path.Rectangle({
    point: [x, y],
    size: [width, height],
    radius: Math.max(0, Math.min(radius, width / 2, height / 2)),
  });
}

/** A triangle whose tip is rounded off. The rounding starts `tipRound` units
 *  before the tip on both sides and bends through the tip. */
function tailShape(baseLeft, baseRight, tip, tipRound) {
  const towards = (from, to, distance) => {
    const side = to.subtract(from);
    return to.subtract(side.normalize(Math.min(distance, side.length * 0.45)));
  };
  const tail = new paper.Path();
  tail.moveTo(baseLeft);
  if (tipRound > 0) {
    tail.lineTo(towards(baseLeft, tip, tipRound));
    tail.quadraticCurveTo(tip, towards(baseRight, tip, tipRound));
  } else {
    tail.lineTo(tip);
  }
  tail.lineTo(baseRight);
  tail.closePath();
  return tail;
}

/** The matrix that places a bubble. It is applied right to left: first the
 *  flips and the scale, then the rotation, then the move to (x, y). So x and y
 *  are always where the centre of the bubble's body ends up. */
export function bubbleMatrix(bubble) {
  return new paper.Matrix()
    .translate(bubble.x, bubble.y)
    .rotate(bubble.rotation)
    .scale(bubble.scale * (bubble.flipH ? -1 : 1), bubble.scale * (bubble.flipV ? -1 : 1));
}

/** A speech bubble: a rounded rectangle with a tail hanging from its bottom
 *  edge. It is built around the origin and then placed by bubbleMatrix. */
export function bubbleShape(bubble) {
  const { width, height } = bubble;
  const radius = Math.min(bubble.radius, width / 2, height / 2);
  let shape = roundedRect(-width / 2, -height / 2, width, height, radius);
  if (bubble.tailLength > 0 && bubble.tailWidth > 0) {
    // The tail's base sits where the bottom corners start to curve. At that
    // height the body spans its full width, so the base is inside the body
    // wherever the tail is placed, even under a corner.
    const baseY = height / 2 - radius;
    const centerX = -width / 2 + bubble.tailPosition * width;
    const clampX = (x) => Math.max(-width / 2, Math.min(width / 2, x));
    const baseLeft = new paper.Point(clampX(centerX - bubble.tailWidth / 2), baseY);
    const baseRight = new paper.Point(clampX(centerX + bubble.tailWidth / 2), baseY);
    const tip = new paper.Point(centerX + bubble.tailLean * bubble.tailLength, height / 2 + bubble.tailLength);
    shape = shape.unite(tailShape(baseLeft, baseRight, tip, bubble.tailRound));
  }
  shape.transform(bubbleMatrix(bubble));
  return shape;
}

/** A stripe: a bar of the given length and thickness around a centre point,
 *  turned by `angle` degrees. */
export function bar(center, length, thickness, angle, roundEnds) {
  const shape = roundedRect(center.x - length / 2, center.y - thickness / 2, length, thickness, roundEnds ? thickness / 2 : 0);
  shape.rotate(angle, center);
  return shape;
}

/** The two points where two outlines cross that lie furthest apart. For two
 *  circles these are the ends of the common chord. Bubbles can cross in more
 *  than two points, for example when a tail pokes through the other bubble,
 *  and then the widest pair is the one that spans the overlap. */
function widestCrossing(a, b) {
  const points = a.getIntersections(b).map((crossing) => crossing.point);
  let widest = null;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const distance = points[i].getDistance(points[j]);
      if (!widest || distance > widest.distance) widest = { from: points[i], to: points[j], distance };
    }
  }
  return widest;
}

/** The line that splits the overlap of two shapes between them. It starts as
 *  the common chord, the line through the two points where the outlines cross.
 *  `tilt` turns it around its middle and `shift` slides it sideways. Returns
 *  null when the outlines do not cross. */
export function splitLine(a, b, tilt, shift) {
  const chord = widestCrossing(a, b);
  if (!chord || chord.distance < 0.01) return null;
  const direction = chord.to.subtract(chord.from).normalize().rotate(tilt);
  const normal = new paper.Point(-direction.y, direction.x);
  const middle = chord.from.add(chord.to).divide(2).add(normal.multiply(shift));
  return { middle, direction, normal, crossings: [chord.from, chord.to] };
}

/** Which side of the line a point is on: 1 or -1. */
export const sideOf = (line, point) => (point.subtract(line.middle).dot(line.normal) >= 0 ? 1 : -1);

/** Everything on one side of the line, as a very large rectangle. */
export function halfPlane(line, side) {
  const along = line.direction.multiply(FAR);
  const away = line.normal.multiply(FAR * side);
  const start = line.middle.subtract(along);
  const end = line.middle.add(along);
  return new paper.Path({ segments: [start, end, end.add(away), start.add(away)], closed: true });
}

/** A band of the given width along the line, used to cut a gap. */
export function bandAlong(line, width) {
  const along = line.direction.multiply(FAR);
  const half = line.normal.multiply(width / 2);
  const start = line.middle.subtract(along);
  const end = line.middle.add(along);
  return new paper.Path({ segments: [start.subtract(half), end.subtract(half), end.add(half), start.add(half)], closed: true });
}

export const point = (x, y) => new paper.Point(x, y);

/** The smallest box around several shapes, or null when all are empty. */
export function boundsOf(items) {
  const filled = items.filter((item) => !item.isEmpty());
  if (filled.length === 0) return null;
  return filled.map((item) => item.bounds).reduce((all, bounds) => all.unite(bounds));
}
