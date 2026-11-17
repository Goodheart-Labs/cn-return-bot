/** Midnight UTC at the start of today. The daily spend caps of both products count from here. */
export function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
