/** How the overlap rules see a stretch of page text. A DOM Range is one, and
 *  the tests use plain numbers. */
export interface SpanOrder<T> {
  /** Negative when `a` starts before `b`, positive when after, zero when equal. */
  compareStarts: (a: T, b: T) => number;
  overlaps: (a: T, b: T) => boolean;
}

/** Spreads the spans over at most `layerCount` layers, so that no two spans in
 *  one layer overlap. Each span goes into the first layer where it overlaps
 *  nothing, walking the spans from the start of the page. A span that overlaps
 *  something in every layer goes into the last layer. Each layer is painted
 *  with the same see-through tint, so text under two quotes looks darker than
 *  text under one, and text under three or more stops getting darker. */
export function assignLayers<T>(spans: readonly T[], order: SpanOrder<T>, layerCount: number): T[][] {
  const layers: T[][] = Array.from({ length: layerCount }, () => []);
  for (const span of [...spans].sort(order.compareStarts)) {
    const free = layers.find((layer) => !layer.some((other) => order.overlaps(span, other)));
    (free ?? layers[layerCount - 1]!).push(span);
  }
  return layers;
}

/** The item whose text is shortest, which is the most specific one where
 *  several quotes cover the same words. A click on such words opens this one. */
export function mostSpecific<T>(items: readonly T[], lengthOf: (item: T) => number): T | null {
  let best: T | null = null;
  for (const item of items) if (best === null || lengthOf(item) < lengthOf(best)) best = item;
  return best;
}
