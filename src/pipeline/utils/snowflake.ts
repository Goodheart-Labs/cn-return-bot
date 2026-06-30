/** Twitter/X epoch (Nov 4, 2010) — the offset baked into every snowflake id. */
const TWITTER_EPOCH_MS = 1288834974657n;

/** Milliseconds since the Unix epoch encoded in a Twitter/X snowflake id. */
export function snowflakeToMillis(id: string | bigint): number {
  return Number((BigInt(id) >> 22n) + TWITTER_EPOCH_MS);
}

/** Creation date encoded in a Twitter/X snowflake id. */
export function snowflakeToDate(id: string | bigint): Date {
  return new Date(snowflakeToMillis(id));
}

/** Smallest snowflake id that could have been created at the given epoch-millis timestamp. */
export function millisToSnowflakeFloor(millis: number): bigint {
  return (BigInt(Math.floor(millis)) - TWITTER_EPOCH_MS) << 22n;
}
