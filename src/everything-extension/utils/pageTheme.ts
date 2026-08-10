/** Works out which theme the host page is actually painting, and watches for changes
 *  to it. Our shadow-root overlays follow the page they sit on rather than the
 *  operating system's setting. Substack's reader can render dark under a light OS
 *  theme, and the other way round. The approach is the one Dark Reader uses to spot
 *  a built-in dark theme. We prefer the page's own `color-scheme` declaration. When
 *  that says nothing, we judge the luminance of the background it renders. */

/** Turns one colour component into a number between 0 and 1. The component can be
 *  written as a decimal such as "0.5", as a percentage such as "50%", or as the
 *  keyword "none". */
function channel(v: string): number {
  if (v === "none") return 0;
  return v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v);
}

function parseColor(value: string): { r: number; g: number; b: number; a: number } | null {
  // This branch matches the legacy rgb() and rgba() serialization.
  let m = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: m[4] === undefined ? 1 : +m[4]! };
  // Wide-gamut colours keep their color() function form in getComputedStyle, and
  // Substack paints in display-p3. Their components run from 0 to 1. We treat all of
  // these colour spaces alike. The small differences between their channels do not
  // matter when the only decision is light or dark.
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
  // These colour spaces start with a lightness component. That component on its own
  // is a good enough signal for light or dark. We return it as a shade of grey, so
  // that luminance() gives the same number back.
  m = value.match(/^(oklab|oklch|lab|lch)\(\s*([\d.]+%?|none)\s+[^/)]+(?:\/\s*([\d.]+%?|none)\s*)?\)$/);
  if (m) {
    const raw = m[2]!;
    let lightness = channel(raw);
    // In lab() and lch() a bare lightness number runs from 0 to 100.
    if (!raw.endsWith("%") && (m[1] === "lab" || m[1] === "lch")) lightness /= 100;
    const v = lightness * 255;
    return { r: v, g: v, b: v, a: m[3] === undefined ? 1 : channel(m[3]!) };
  }
  return null;
}

/** Returns how light a colour looks, on a scale from 0 to 1. It applies the Rec. 709
 *  weights to the raw sRGB values. This is the same formula Dark Reader uses. It is
 *  accurate enough for deciding between light and dark. */
function luminance(c: { r: number; g: number; b: number }): number {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

const DARK_BELOW = 0.45;
const OPAQUE_ENOUGH = 0.05;

/** Reads the page's `color-scheme` declaration. A declaration that names a single
 *  scheme settles the question on its own. The values "normal" and "light dark" say
 *  nothing about which of the two the page is painting right now, so they return
 *  null. */
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

/** Tells you whether the page paints a dark backdrop where our UI sits. `from` is the
 *  element the overlay is anchored to, such as the article container. We walk up from
 *  there, so a dark backdrop painted on an inner wrapper wins over a white body. */
export function isPageDark(from?: Element | null): boolean {
  const declared = declaredScheme();
  if (declared !== null) return declared;
  for (let el: Element | null = from ?? document.body; el; el = el.parentElement) {
    const bg = parseColor(getComputedStyle(el).backgroundColor);
    if (bg && bg.a > OPAQUE_ENOUGH) return luminance(bg) < DARK_BELOW;
  }
  // Every element up the chain was transparent. A page whose text is light must be a
  // dark page.
  const text = parseColor(getComputedStyle(document.body ?? document.documentElement).color);
  return text ? luminance(text) > 1 - DARK_BELOW : false;
}

const RECHECK_DEBOUNCE_MS = 100;

/** Watches for theme flips. Substack's reader and YouTube switch theme by swapping a
 *  class or an attribute on html or body, without reloading the page. `onChange` is
 *  called only when the detected theme really changed. The returned function stops
 *  the watching. */
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
    // A single-page app can replace the whole body element. We attach the observer to
    // the new one, so that its attribute changes stay covered.
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
