import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_PILL_PALETTE, PillPaletteContext, type PillPalette } from "@cn/features/notes/pillPalette";
import { getSettings, onSettingsChanged } from "../utils/settings";

/** Colours the rating pills the way the reader chose on the settings page. A
 *  change there reaches notes that are already open, without a reload. */
export function PillPaletteFromSettings({ children }: { children: ReactNode }) {
  const [palette, setPalette] = useState<PillPalette>(DEFAULT_PILL_PALETTE);
  useEffect(() => {
    const load = () => void getSettings().then((settings) => setPalette(settings.pillPalette));
    load();
    return onSettingsChanged(load);
  }, []);
  return <PillPaletteContext.Provider value={palette}>{children}</PillPaletteContext.Provider>;
}
