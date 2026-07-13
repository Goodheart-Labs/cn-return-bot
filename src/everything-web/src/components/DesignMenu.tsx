import { useEffect, useState } from "react";

/** Experimental design menu, fixed bottom-left: color-scheme swatches and a
 *  font-size toggle. Each control sets a data attribute on <html> (styled by
 *  design.css) and persists the choice. Defaults are dark (blue accent) +
 *  large; "blue"/"normal" are the plain palette with no overrides. "large"
 *  bumps every text tier one tick (except the surrounding-context excerpt,
 *  pinned small). */
const SCHEMES = [
  { id: "blue", label: "Blue (default)", swatch: "#2563eb" },
  { id: "beige", label: "Professional beige", swatch: "#c9b27f" },
  { id: "taupe", label: "Light taupe", swatch: "#b18f72" },
  { id: "dark", label: "Dark · blue accent", swatch: "linear-gradient(135deg, #171b21 50%, #2563eb 50%)" },
  { id: "dark-orange", label: "Dark · orange accent", swatch: "linear-gradient(135deg, #171b21 50%, #ea580c 50%)" },
] as const;
type SchemeId = (typeof SCHEMES)[number]["id"];

const FONT_SIZES = [
  { id: "normal", label: "Normal font size", cls: "text-xs" },
  { id: "large", label: "Large font size", cls: "text-sm" },
] as const;
type FontSizeId = (typeof FONT_SIZES)[number]["id"];

const SCHEME_KEY = "cn-scheme";
const FONTSIZE_KEY = "cn-fontsize";

export function DesignMenu() {
  const [scheme, setScheme] = useState<SchemeId>(
    () => (localStorage.getItem(SCHEME_KEY) as SchemeId) ?? "dark",
  );
  const [fontSize, setFontSize] = useState<FontSizeId>(
    () => (localStorage.getItem(FONTSIZE_KEY) as FontSizeId) ?? "large",
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-scheme", scheme);
    localStorage.setItem(SCHEME_KEY, scheme);
  }, [scheme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-fontsize", fontSize);
    localStorage.setItem(FONTSIZE_KEY, fontSize);
  }, [fontSize]);

  return (
    <div className="fixed bottom-3 left-3 z-40 flex items-center gap-2 bg-white border border-gray-200 rounded-full px-2.5 py-1.5 shadow-sm">
      {SCHEMES.map(({ id, label, swatch }) => (
        <button
          key={id}
          type="button"
          title={label}
          aria-label={`Color scheme: ${label}`}
          aria-pressed={scheme === id}
          onClick={() => setScheme(id)}
          className={`w-4 h-4 rounded-full border border-gray-300 transition-transform ${
            scheme === id ? "scale-125 ring-2 ring-offset-1 ring-gray-400" : "hover:scale-110"
          }`}
          style={{ background: swatch }}
        />
      ))}
      <span className="w-px h-4 bg-gray-200" aria-hidden />
      {FONT_SIZES.map(({ id, label, cls }) => (
        <button
          key={id}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={fontSize === id}
          onClick={() => setFontSize(id)}
          className={`${cls} leading-none font-semibold px-1 rounded ${
            fontSize === id ? "text-gray-900 bg-gray-100" : "text-gray-400 hover:text-gray-700"
          }`}
        >
          A
        </button>
      ))}
    </div>
  );
}
