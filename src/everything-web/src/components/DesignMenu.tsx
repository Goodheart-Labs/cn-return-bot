import { Fragment, useEffect, useState } from "react";
import {
  ROLES, DEFAULT_ROLES, ROLE_KEY, TONE_KEY, MIN_TONE, MAX_TONE,
  optionHex, optionsForRole, applyFlexokiRoles, loadRoles, loadTone,
  type RoleSelection,
} from "../lib/flexoki";
import { readStored, writeStored } from "../lib/safeStorage";

/** The experimental design menu, fixed to the bottom left corner. It offers
 *  color-scheme swatches and a font-size toggle. Each control sets a data
 *  attribute on the <html> element, which design.css styles, and saves the
 *  choice. With nothing saved the scheme follows the operating system and the
 *  font size is "large". The "blue" scheme and the "normal" font size are the
 *  plain palette and the plain scale, with no overrides at all. The "large" size
 *  bumps every text tier up one step, except the surrounding-context excerpt,
 *  which stays small. While the Flexoki scheme ("beige") is active, a ⚙ button
 *  opens a panel that remaps any Flexoki accent onto any semantic role, live. */
/** A scheme's `shape` is "rect" on the newer schemes, which are Flexoki and
 *  warm-neutral, and "circle" on every other scheme. It is a permanent visual
 *  tag on the swatch in the picker. It does not follow the active theme, which
 *  may itself square off every corner. */
const SCHEMES = [
  { id: "blue", label: "Blue (default)", swatch: "#2563eb", shape: "circle" },
  { id: "brown", label: "Brown (classic)", swatch: "#8a6d3b", shape: "circle" },
  { id: "taupe-classic", label: "Taupe (classic)", swatch: "#b18f72", shape: "circle" },
  { id: "dark", label: "Dark · blue accent", swatch: "linear-gradient(135deg, #171b21 50%, #2563eb 50%)", shape: "circle" },
  { id: "dark-orange", label: "Dark · orange accent", swatch: "linear-gradient(135deg, #171b21 50%, #ea580c 50%)", shape: "circle" },
  { id: "beige", label: "Flexoki (paper)", swatch: "#DFB431", shape: "rect" },
  { id: "taupe", label: "Warm-neutral", swatch: "linear-gradient(135deg, #E6D3A9 50%, #4F7197 50%)", shape: "rect" },
] as const;
type SchemeId = (typeof SCHEMES)[number]["id"];

const FONT_SIZES = [
  { id: "normal", label: "Normal font size", cls: "text-xs" },
  { id: "large", label: "Large font size", cls: "text-sm" },
] as const;
type FontSizeId = (typeof FONT_SIZES)[number]["id"];

const SCHEME_KEY = "cn-scheme";
const FONTSIZE_KEY = "cn-fontsize";

/** Kill switch for the experimental design menu. While this is false the picker
 *  is hidden and any experiment saved in localStorage is ignored. The site then
 *  follows the operating system's theme as it changes. A light system gets the
 *  blue scheme and a dark one gets the dark scheme with the blue accent, both at
 *  the standard large font size. */
const SHOW_DESIGN_MENU = false;

/** Returns the blue scheme on a light system. On a dark one it returns the dark
 *  scheme, which is black with a blue accent. */
function systemScheme(): SchemeId {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "blue";
}

export function DesignMenu() {
  return SHOW_DESIGN_MENU ? <DesignMenuPanel /> : <SystemThemeSync />;
}

/** Applies the standard design and tracks OS theme changes live. */
function SystemThemeSync() {
  useEffect(() => {
    document.documentElement.setAttribute("data-fontsize", "large");
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.setAttribute("data-scheme", systemScheme());
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return null;
}

function DesignMenuPanel() {
  const [scheme, setScheme] = useState<SchemeId>(
    () => (readStored(SCHEME_KEY) as SchemeId) ?? systemScheme(),
  );
  const [fontSize, setFontSize] = useState<FontSizeId>(
    () => (readStored(FONTSIZE_KEY) as FontSizeId) ?? "large",
  );
  const [roles, setRoles] = useState<RoleSelection>(loadRoles);
  const [tone, setTone] = useState<number>(loadTone);
  const [flexokiOpen, setFlexokiOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-scheme", scheme);
    writeStored(SCHEME_KEY, scheme);
  }, [scheme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-fontsize", fontSize);
    writeStored(FONTSIZE_KEY, fontSize);
  }, [fontSize]);

  useEffect(() => {
    applyFlexokiRoles(roles, tone);
    writeStored(ROLE_KEY, JSON.stringify(roles));
    writeStored(TONE_KEY, String(tone));
  }, [roles, tone]);

  const isFlexoki = scheme === "beige";

  return (
    <div className="fixed bottom-3 left-3 z-40 flex flex-col items-start gap-2">
      {isFlexoki && flexokiOpen && (
        <div className="w-80 bg-white border border-gray-200 rounded-lg shadow-sm p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700">Flexoki accent mapping</span>
            <button
              type="button"
              onClick={() => { setRoles({ ...DEFAULT_ROLES }); setTone(0); }}
              className="text-xs text-blue-600 hover:underline"
            >
              Reset
            </button>
          </div>
          {ROLES.map((role) => (
            <div key={role.id} className="flex items-start gap-2">
              <span className="w-20 shrink-0 text-xs text-gray-500 pt-0.5">{role.label}</span>
              <div className="flex flex-wrap gap-1">
                {optionsForRole(role.id).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    title={`${role.label}: ${option.label}`}
                    aria-label={`${role.label}: ${option.label}`}
                    aria-pressed={roles[role.id] === option.id}
                    onClick={() => setRoles((prev) => ({ ...prev, [role.id]: option.id }))}
                    className={`w-4 h-4 rounded-full border border-gray-300 transition-transform ${
                      roles[role.id] === option.id ? "scale-125 ring-2 ring-offset-1 ring-gray-400" : "hover:scale-110"
                    }`}
                    style={{ background: optionHex(role.id, option.id) }}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
            <span className="w-20 shrink-0 text-xs text-gray-500">Depth</span>
            <input
              type="range"
              min={MIN_TONE}
              max={MAX_TONE}
              step={1}
              value={tone}
              onChange={(e) => setTone(Number(e.target.value))}
              aria-label="Color depth (light to dark)"
              className="flex-1 accent-gray-500"
            />
            <span className="w-6 text-right text-xs tabular-nums text-gray-400">{tone > 0 ? `+${tone}` : tone}</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-2.5 py-1.5 shadow-sm">
        {SCHEMES.map(({ id, label, swatch, shape }, i) => (
          <Fragment key={id}>
            {/* The divider between the round classic swatches and the square new ones. */}
            {shape === "rect" && SCHEMES[i - 1]?.shape !== "rect" && (
              <span className="w-px h-4 bg-gray-200" aria-hidden />
            )}
            <button
              type="button"
              title={label}
              aria-label={`Color scheme: ${label}`}
              aria-pressed={scheme === id}
              onClick={() => setScheme(id)}
              className={`w-4 h-4 border border-gray-300 transition-transform ${
                scheme === id ? "scale-125 ring-2 ring-offset-1 ring-gray-400" : "hover:scale-110"
              }`}
              // The radius is set inline so the swatch keeps its shape even when
              // the active theme squares off every `rounded-*` class.
              style={{ background: swatch, borderRadius: shape === "rect" ? "2px" : "9999px" }}
            />
          </Fragment>
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
        {isFlexoki && (
          <>
            <span className="w-px h-4 bg-gray-200" aria-hidden />
            <button
              type="button"
              title="Customize Flexoki accents"
              aria-label="Customize Flexoki accents"
              aria-pressed={flexokiOpen}
              onClick={() => setFlexokiOpen((o) => !o)}
              className={`text-xs leading-none px-1 rounded ${
                flexokiOpen ? "text-gray-900 bg-gray-100" : "text-gray-400 hover:text-gray-700"
              }`}
            >
              ⚙
            </button>
          </>
        )}
      </div>
    </div>
  );
}
