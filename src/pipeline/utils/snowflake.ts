/** The Twitter/X epoch, 4 November 2010. This offset is baked into every
 *  snowflake id. */
const TWITTER_EPOCH_MS = 1288834974657n;

/** Returns the milliseconds since the Unix epoch that a Twitter/X snowflake id
 *  encodes. */
export function snowflakeToMillis(id: string | bigint): number {
  return Number((BigInt(id) >> 22n) + TWITTER_EPOCH_MS);
}

/** Returns the creation date that a Twitter/X snowflake id encodes. */
export function snowflakeToDate(id: string | bigint): Date {
  return new Date(snowflakeToMillis(id));
}

/** Returns the smallest snowflake id that could have been created at the given
 *  timestamp. The timestamp is in milliseconds since the Unix epoch. */
export function millisToSnowflakeFloor(millis: number): bigint {
  return (BigInt(Math.floor(millis)) - TWITTER_EPOCH_MS) << 22n;
}
