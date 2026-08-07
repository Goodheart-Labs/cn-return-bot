/**
 * Removes NUL characters (U+0000) from every string inside a value. Arrays and
 * objects are walked recursively.
 *
 * Postgres text and jsonb columns cannot store U+0000. An insert or update that
 * carries one fails with `22P05: unsupported Unicode escape sequence`. NUL bytes
 * reach us through model output. Gemini's media OCR, for example, sometimes
 * mangles an accented character into two NUL bytes. So we scrub every value on
 * its way into a column that holds free text or JSONB. The function returns a
 * new value and never mutates its input.
 */

const NUL = String.fromCharCode(0);

export function stripNullChars<T>(value: T): T {
  if (typeof value === "string") {
    return (value.includes(NUL) ? value.split(NUL).join("") : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(stripNullChars) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) out[key] = stripNullChars(val);
    return out as T;
  }
  return value;
}
