/* What every chart on the website draws with. The colours are design tokens,
 * so dark mode swaps them as it swaps the rest of the page. */

export const AXIS_COLOR = "var(--cn-line-strong)";
export const LABEL_COLOR = "var(--cn-fg-muted)";
export const SURFACE_COLOR = "var(--cn-surface)";
export const TICK_FONT_SIZE = 11;

/** The look of an axis's tick labels. */
export const tickLabel = { fill: LABEL_COLOR, fontSize: TICK_FONT_SIZE };

/** The dark bubble that names the values under the pointer. */
export const tooltipClass = "rounded-control bg-inverse px-2 py-1 text-xs text-on-inverse shadow-floating";
