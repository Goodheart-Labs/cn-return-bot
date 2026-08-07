/** Detect and track the HOST PAGE's effective theme so the shadow-root
 *  overlays match the page they sit on, not the OS setting: Substack's reader
 *  renders dark under a light OS theme (and vice versa). Same approach as
 *  Dark Reader's built-in-dark-theme detection: prefer the standards-based
 *  `color-scheme` signal, else judge the rendered background's luminance. */

/** "0.5" | "50%" | "none" → 0..1 */
function channel(v: string): number {
  if (v === "none") return 0;
  return v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v);
}

function parseColor(value: string): { r: number; g: number; b: number; a: number } | null {
  // Legacy sRGB serialization.
  let m = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: m[4] === undefined ? 1 : +m[4]! };
  // Wide-gamut colors keep their function form in getComputedStyle (Substack
  // paints in display-p3). Components are 0..1; the slight per-space channel
  // differences don't matter for a light/dark call.
  m = value.match(
    /^color\((?:srgb|srgb-linear|display-p3|rec2020|a98-rgb|prophoto-rgb)\s+([\d.]+%?|none)\s+([\d.]+%?|none)\s+([\d.]+%?|none)(?:\s*\/\s*([\d.]+%?|none))?\)$/,
  );
  if (m) {
    return {
      r: channel(m[1]!) * 255,
      g: channel(m[2]!) * 255,
      b: channel(m[3]!) * 255,
      a: m[4] === undefined ? 1 : channel(m[4]!),
    };
  }
  // Lightness-leading spaces: the L component alone is a fine dark/light
  // proxy — report it as a gray so luminance() reproduces it.
  m = value.match(/^(oklab|oklch|lab|lch)\(\s*([\d.]+%?|none)\s+[^/)]+(?:\/\s*([\d.]+%?|none)\s*)?\)$/);
  if (m) {
    const raw = m[2]!;
    let lightness = channel(raw);
    // lab()/lch() lightness is 0..100 when written as a bare number.
    if (!raw.endsWith("%") && (m[1] === "lab" || m[1] === "lch")) lightness /= 100;
    const v = lightness * 255;
    return { r: v, g: v, b: v, a: m[3] === undefined ? 1 : channel(m[3]!) };
  }
  return null;
}

/** Perceived lightness 0..1 (Rec. 709 weights on raw sRGB — the same formula
 *  Dark Reader uses; plenty of precision for a light/dark call). */
function luminance(c: { r: number; g: number; b: number }): number {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

const DARK_BELOW = 0.45;
const OPAQUE_ENOUGH = 0.05;

/** An explicit single-scheme declaration decides outright; "normal" and
 *  "light dark" say nothing about what the page currently paints. */
function declaredScheme(): boolean | null {
  const declared =
    getComputedStyle(document.documentElement).colorScheme ||
    document.querySelector('meta[name="color-scheme"]')?.getAttribute("content") ||
    "";
  const scheme = declared.trim().toLowerCase();
  if (scheme === "dark" || scheme === "only dark") return true;
  if (scheme === "light" || scheme === "only light") return false;
  return null;
}

/** Whether the page paints a dark backdrop where our UI sits. `from` is the
 *  element the overlay anchors to (e.g. the article container) — a dark
 *  backdrop painted on an inner wrapper still wins over a white body. */
export function isPageDark(from?: Element | null): boolean {
  const declared = declaredScheme();
  if (declared !== null) return declared;
  for (let el: Element | null = from ?? document.body; el; el = el.parentElement) {
    const bg = parseColor(getComputedStyle(el).backgroundColor);
    if (bg && bg.a > OPAQUE_ENOUGH) return luminance(bg) < DARK_BELOW;
  }
  // Everything transparent: a page set in light TEXT is a dark page.
  const text = parseColor(getComputedStyle(document.body ?? document.documentElement).color);
  return text ? luminance(text) > 1 - DARK_BELOW : false;
}

const RECHECK_DEBOUNCE_MS = 100;

/** Watch for theme flips (Substack's reader and YouTube toggle themes by
 *  swapping classes/attributes on html or body, no reload). Calls `onChange`
 *  only when the detected theme actually changes. Returns a cleanup. */
export function observePageTheme(
  onChange: (dark: boolean) => void,
  sampleFrom?: () => Element | null,
): () => void {
  let last = isPageDark(sampleFrom?.());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    const dark = isPageDark(sampleFrom?.());
    if (dark === last) return;
    last = dark;
    onChange(dark);
  };
  const observer = new MutationObserver((mutations) => {
    // SPAs can replace <body>; re-attach so its attribute flips stay covered.
    if (mutations.some((m) => m.type === "childList") && document.body) {
      observer.observe(document.body, { attributes: true });
    }
    clearTimeout(timer);
    timer = setTimeout(check, RECHECK_DEBOUNCE_MS);
  });
  observer.observe(document.documentElement, { attributes: true, childList: true });
  if (document.body) observer.observe(document.body, { attributes: true });
  return () => {
    observer.disconnect();
    clearTimeout(timer);
  };
}
