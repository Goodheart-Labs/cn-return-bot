/**
 * Remove NUL (U+0000) characters from every string in a value, recursively.
 *
 * Postgres text and jsonb columns cannot store U+0000 — an insert/update that
 * carries one fails with `22P05: unsupported Unicode escape sequence`. NUL bytes
 * leak in from model output (e.g. Gemini media OCR mangling accented characters
 * into two NUL bytes), so we scrub them at every DB-write boundary that persists
 * free-text or JSONB. Returns a new value; the input is not mutated.
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
