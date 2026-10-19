import { useRef, useState, type KeyboardEvent } from "react";
import { BROWSERS, browserById, detectBrowser, type BrowserId } from "../../lib/extensionStores";

/** The install section's tabs, one per browser, opened on the reader's own
 *  browser. Left and right arrows move between the tabs, as in any tab list.
 *  Spread `tabProps(i)` on each tab and `panelProps` on the panel. */
export function useInstallTabs() {
  const [selected, setSelected] = useState<BrowserId>(detectBrowser);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = (index + step + BROWSERS.length) % BROWSERS.length;
    setSelected(BROWSERS[next]!.id);
    tabs.current[next]?.focus();
  };

  return {
    browser: browserById(selected),
    tabListProps: { role: "tablist", "aria-label": "Browser" } as const,
    tabProps: (index: number) => {
      const id = BROWSERS[index]!.id;
      return {
        ref: (el: HTMLButtonElement | null) => {
          tabs.current[index] = el;
        },
        type: "button" as const,
        role: "tab" as const,
        id: `install-tab-${id}`,
        "aria-selected": id === selected,
        "aria-controls": "install-panel",
        tabIndex: id === selected ? 0 : -1,
        onClick: () => setSelected(id),
        onKeyDown: (event: KeyboardEvent) => onKeyDown(event, index),
      };
    },
    panelProps: { id: "install-panel", role: "tabpanel", "aria-labelledby": `install-tab-${selected}` } as const,
  };
}
