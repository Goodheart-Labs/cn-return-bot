export function mergeFeedNotes<T>(helpful: readonly T[], needRatings: readonly T[]): T[] {
  const merged = helpful.slice(0, 3);
  for (let i = 0; i < Math.max(needRatings.length, helpful.length - 3); i++) {
    if (i < needRatings.length) merged.push(needRatings[i]!);
    if (i + 3 < helpful.length) merged.push(helpful[i + 3]!);
  }
  return merged;
}
