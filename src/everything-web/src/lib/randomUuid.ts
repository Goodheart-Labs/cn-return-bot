/* crypto.randomUUID does not exist in browsers older than roughly 2022, and it
 * is also absent from any page that the browser does not treat as a secure
 * context. Calling it unguarded threw and took the whole site down for those
 * readers, so every caller on the website goes through this instead.
 *
 * The result has to be a real version 4 UUID and not merely a unique-looking
 * string, because the device id ends up in a uuid column and the database
 * rejects anything else. */
export function randomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // The version and variant bits are fixed values in a version 4 UUID.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
