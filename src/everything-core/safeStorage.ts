/* A browser does not always let a page use localStorage. Reading the property
 * throws outright when the reader has turned site data off for the site, and
 * writing throws in a private window that allows no storage at all. Everything
 * the site keeps there is a convenience: a device id for counting visits, a
 * colour scheme, a font size. None of it is worth a broken page, and an
 * unguarded call to localStorage broke the whole site for readers in exactly
 * that situation. Every access from the website goes through these two
 * functions, so a browser without usable storage simply falls back to the
 * defaults and keeps working. */

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nowhere to keep it. The value stays in memory for this page instead.
  }
}
