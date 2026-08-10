/** The Flexoki accent ramps from stephango.com/flexoki, and the mapping from
 *  role to accent that the DesignMenu lets you change live. The beige scheme's
 *  CSS reads one custom property per role and shade, named --cn-{role}-{shade}.
 *  This module overrides those properties with inline styles on <html>, so any
 *  accent can be given to any role at runtime. The defaults follow Flexoki's own
 *  semantics: links are cyan, success is green, warning is orange and error is
 *  red. The page background is warm paper, and by default the note surface
 *  blends into it rather than taking a colored wash.
 *
 *  One global `tone` offset slides every color this module derives the same
 *  number of stops along the 50 to 950 scale. It is a single knob for the depth
 *  of the whole palette. A negative tone is paler and a positive tone is deeper.
 *  Body text is not set here and stays fixed in the CSS, which keeps the theme
 *  legible across the whole range. */

export type AccentId =
  | "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "purple" | "magenta";
/** The note surface may also be "bg", which blends it into the page background
 *  instead of giving it a colored wash. */
export type NoteId = AccentId | "bg";
export type RoleId = "bg" | "card" | "link" | "helpful" | "somewhat" | "nothelpful" | "note";

export type Shade =
  | "50" | "100" | "150" | "200" | "300" | "400" | "500"
  | "600" | "700" | "800" | "850" | "900" | "950";
/** The steps of the neutral surface ramp. It is Flexoki's Base ramp with white
 *  and paper added at the light end and black at the dark end. The page
 *  background and the card use it. */
export type BaseStep = "white" | "paper" | Shade | "black";

export type RoleSelection = {
  bg: BaseStep;
  card: BaseStep;
  link: AccentId;
  helpful: AccentId;
  somewhat: AccentId;
  nothelpful: AccentId;
  note: NoteId;
};
type Ramp = Record<Shade, string>;

/** The ramp stops in order. The gaps are irregular on purpose, so there is no
 *  250 and no 350. A tone offset is an index shift within this array. */
const STEPS: Shade[] = ["50", "100", "150", "200", "300", "400", "500", "600", "700", "800", "850", "900", "950"];

export const MIN_TONE = -3;
export const MAX_TONE = 4;

/** The full accent ramps, from 50 through to 950, covering light and dark. */
export const FLEXOKI: Record<AccentId, Ramp> = {
  red:     { "50": "#FFE1D5", "100": "#FFCABB", "150": "#FDB2A2", "200": "#F89A8A", "300": "#E8705F", "400": "#D14D41", "500": "#C03E35", "600": "#AF3029", "700": "#942822", "800": "#6C201C", "850": "#551B18", "900": "#3E1715", "950": "#261312" },
  orange:  { "50": "#FFE7CE", "100": "#FED3AF", "150": "#FCC192", "200": "#F9AE77", "300": "#EC8B49", "400": "#DA702C", "500": "#CB6120", "600": "#BC5215", "700": "#9D4310", "800": "#71320D", "850": "#59290D", "900": "#40200D", "950": "#27180E" },
  yellow:  { "50": "#FAEEC6", "100": "#F6E2A0", "150": "#F1D67E", "200": "#ECCB60", "300": "#DFB431", "400": "#D0A215", "500": "#BE9207", "600": "#AD8301", "700": "#8E6B01", "800": "#664D01", "850": "#503D02", "900": "#3A2D04", "950": "#241E08" },
  green:   { "50": "#EDEECF", "100": "#DDE2B2", "150": "#CDD597", "200": "#BEC97E", "300": "#A0AF54", "400": "#879A39", "500": "#768D21", "600": "#66800B", "700": "#536907", "800": "#3D4C07", "850": "#313D07", "900": "#252D09", "950": "#1A1E0C" },
  cyan:    { "50": "#DDF1E4", "100": "#BFE8D9", "150": "#A2DECE", "200": "#87D3C3", "300": "#5ABDAC", "400": "#3AA99F", "500": "#2F968D", "600": "#24837B", "700": "#1C6C66", "800": "#164F4A", "850": "#143F3C", "900": "#122F2C", "950": "#101F1D" },
  blue:    { "50": "#E1ECEB", "100": "#C6DDE8", "150": "#ABCFE2", "200": "#92BFDB", "300": "#66A0C8", "400": "#4385BE", "500": "#3171B2", "600": "#205EA6", "700": "#1A4F8C", "800": "#163B66", "850": "#133051", "900": "#12253B", "950": "#101A24" },
  purple:  { "50": "#F0EAEC", "100": "#E2D9E9", "150": "#D3CAE6", "200": "#C4B9E0", "300": "#A699D0", "400": "#8B7EC8", "500": "#735EB5", "600": "#5E409D", "700": "#4F3685", "800": "#3C2A62", "850": "#31234E", "900": "#261C39", "950": "#1A1623" },
  magenta: { "50": "#FEE4E5", "100": "#FCCFDA", "150": "#F9B9CF", "200": "#F4A4C2", "300": "#E47DA8", "400": "#CE5D97", "500": "#B74583", "600": "#A02F6F", "700": "#87285E", "800": "#641F46", "850": "#4F1B39", "900": "#39172B", "950": "#24131D" },
};

/** The neutral surface ramp. It is Flexoki's warm base with white and paper at
 *  the light end and black at the dark end. The page background and the card
 *  use it. */
const BASE_STEPS: BaseStep[] = ["white", "paper", "50", "100", "150", "200", "300", "400", "500", "600", "700", "800", "850", "900", "950", "black"];
const BASE: Record<BaseStep, string> = {
  white: "#FFFFFF", paper: "#FFFCF0",
  "50": "#F2F0E5", "100": "#E6E4D9", "150": "#DAD8CE", "200": "#CECDC3", "300": "#B7B5AC", "400": "#9F9D96", "500": "#878580", "600": "#6F6E69", "700": "#575653", "800": "#403E3C", "850": "#343331", "900": "#282726", "950": "#1C1B1A",
  black: "#100F0F",
};

/** Slide a ramp stop by `tone` positions along its scale, clamped to the ends. */
function shift<T extends string>(list: T[], step: T, tone: number): T {
  const i = list.indexOf(step) + tone;
  return list[Math.max(0, Math.min(list.length - 1, i))]!;
}

/** Clamp an index into the neutral surface ramp. */
const clampIdx = (i: number): number => Math.max(0, Math.min(BASE_STEPS.length - 1, i));

export const ACCENTS: { id: AccentId; label: string }[] = [
  { id: "red", label: "Red" },
  { id: "orange", label: "Orange" },
  { id: "yellow", label: "Yellow" },
  { id: "green", label: "Green" },
  { id: "cyan", label: "Cyan" },
  { id: "blue", label: "Blue" },
  { id: "purple", label: "Purple" },
  { id: "magenta", label: "Magenta" },
];

export const ROLES: { id: RoleId; label: string }[] = [
  { id: "bg", label: "Background" },
  { id: "card", label: "Card" },
  { id: "link", label: "Accent / links" },
  { id: "helpful", label: "Helpful" },
  { id: "somewhat", label: "Somewhat" },
  { id: "nothelpful", label: "Not helpful" },
  { id: "note", label: "Note surface" },
];

/** The default mapping, in the style of LessWrong. The page is warm paper, the
 *  card is faintly tinted, links are cyan, and the note blends into the
 *  background with no colored wash. */
export const DEFAULT_ROLES: RoleSelection = {
  bg: "paper", card: "50", link: "cyan", helpful: "green", somewhat: "orange", nothelpful: "red", note: "bg",
};

const baseLabel = (step: BaseStep): string =>
  step === "white" ? "White" : step === "paper" ? "Paper" : step === "black" ? "Black" : `Base ${step}`;

/** The swatch color shown for one role option in the menu. Background and Card
 *  show the actual neutral step. The note's blend option shows a neutral chip.
 *  Every accent shows its 600. */
export function optionHex(roleId: RoleId, id: string): string {
  if (roleId === "bg" || roleId === "card") return BASE[id as BaseStep];
  if (roleId === "note" && id === "bg") return "#CECDC3"; // A neutral chip stands for "same as background".
  return FLEXOKI[id as AccentId]["600"];
}

/** The picker options for one role. Background and card offer the neutral
 *  surface steps, running from white through paper and the base ramp to black.
 *  The note offers the eight accents plus the option to blend into the
 *  background. Every other role offers just the eight accent hues. */
export function optionsForRole(roleId: RoleId): { id: string; label: string }[] {
  if (roleId === "bg" || roleId === "card") return BASE_STEPS.map((step) => ({ id: step, label: baseLabel(step) }));
  if (roleId === "note") return [{ id: "bg", label: "Same as background" }, ...ACCENTS];
  return ACCENTS;
}

/** The ramp stops each color role's CSS reads, before any tone is applied. The
 *  variable keeps the name of the base step, while its value is the
 *  tone-shifted color. */
const ROLE_SHADES: Record<"link" | "helpful" | "somewhat" | "nothelpful", Shade[]> = {
  link: ["50", "100", "500", "600", "700"],
  helpful: ["50", "100", "150", "200", "600", "700"],
  somewhat: ["50", "100", "150", "200", "600", "700"],
  nothelpful: ["50", "100", "150", "600", "700", "800"],
};

/** Write a role to accent mapping onto <html> as inline custom properties, with
 *  every color shifted by `tone`. */
export function applyFlexokiRoles(roles: RoleSelection, tone = 0): void {
  const style = document.documentElement.style;
  (Object.keys(ROLE_SHADES) as (keyof typeof ROLE_SHADES)[]).forEach((role) => {
    const ramp = FLEXOKI[roles[role]];
    ROLE_SHADES[role].forEach((step) => style.setProperty(`--cn-${role}-${step}`, ramp[shift(STEPS, step, tone)]));
  });
  style.setProperty("--cn-bg", BASE[shift(BASE_STEPS, roles.bg, tone)]);
  style.setProperty("--cn-card", BASE[shift(BASE_STEPS, roles.card, tone)]);
  /* The elevated surface is used by dropdowns and popovers. It sits one step
   * lighter than the page so that it reads as raised. It goes darker instead
   * only when the page is already the lightest step, which is white. It is
   * derived from the background, so it always tracks it. */
  const bgIdx = BASE_STEPS.indexOf(shift(BASE_STEPS, roles.bg, tone));
  const raiseDarker = bgIdx <= 0;
  style.setProperty("--cn-elevated", BASE[BASE_STEPS[clampIdx(raiseDarker ? bgIdx + 2 : bgIdx - 1)]!]);
  style.setProperty("--cn-elevated-border", BASE[BASE_STEPS[clampIdx(raiseDarker ? bgIdx + 3 : bgIdx + 1)]!]);
  if (roles.note === "bg") {
    // Blend into the page background, with a hairline edge one step darker.
    style.setProperty("--cn-note-bg", BASE[shift(BASE_STEPS, roles.bg, tone)]);
    style.setProperty("--cn-note-border", BASE[shift(BASE_STEPS, roles.bg, tone + 1)]);
  } else {
    const note = FLEXOKI[roles.note];
    style.setProperty("--cn-note-bg", note[shift(STEPS, "50", tone)]);
    style.setProperty("--cn-note-border", note[shift(STEPS, "150", tone)]);
  }
}

export const ROLE_KEY = "cn-flexoki-roles";
export const TONE_KEY = "cn-flexoki-tone";

export function loadRoles(): RoleSelection {
  try {
    const raw = localStorage.getItem(ROLE_KEY);
    if (raw) return { ...DEFAULT_ROLES, ...JSON.parse(raw) };
  } catch {
    /* Fall through to the defaults. */
  }
  return { ...DEFAULT_ROLES };
}

export function loadTone(): number {
  const raw = Number(localStorage.getItem(TONE_KEY));
  if (Number.isFinite(raw)) return Math.max(MIN_TONE, Math.min(MAX_TONE, raw));
  return 0;
}
