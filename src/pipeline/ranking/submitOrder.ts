export function orderForSubmit<T>(candidates: T[], score: (c: T) => number): T[] {
  return candidates
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}

export interface BarPartition<T> {
  above: T[];
  explored: T[];
  below: T[];
}

// Everything at or above the bar is kept, in order. From the rest, a slice of about
// `explore` × (kept count) is drawn at random so below-bar posts still get labels.
export function partitionByBar<T>(
  ordered: T[],
  score: (c: T) => number,
  bar: number | null,
  explore: number,
  rng: () => number = Math.random,
): BarPartition<T> {
  if (bar === null) return { above: ordered, explored: [], below: [] };
  const above = ordered.filter((c) => score(c) >= bar);
  const rest = ordered.filter((c) => score(c) < bar);
  const want = Math.min(rest.length, Math.floor(above.length * explore + rng()));
  const shuffled = [...rest];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const explored = shuffled.slice(0, want);
  const chosen = new Set(explored);
  return { above, explored, below: rest.filter((c) => !chosen.has(c)) };
}
