import { useEffect, useState } from "react";
import logoUrl from "@cn/ui/assets/logo.svg";
import { cardVariants } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";
import { IconButton } from "@cn/ui/IconButton";
import { CloseIcon } from "@cn/ui/icons";
import { browserById, canInstallExtensions, detectBrowser, isListed } from "../lib/extensionStores";
import { StoreButton } from "./StoreButton";

/** How long a reader stays on one project before the nudge appears. */
const NUDGE_DELAY_MS = 15_000;

/** Set once the nudge has shown in this browser tab, so it appears once per
 *  visit. Session storage ends with the tab. */
const SHOWN_KEY = "cn:extensionNudgeShown";

function alreadyShown(): boolean {
  try {
    return window.sessionStorage.getItem(SHOWN_KEY) === "1";
  } catch {
    return false;
  }
}

function markShown() {
  try {
    window.sessionStorage.setItem(SHOWN_KEY, "1");
  } catch {
    // Without storage the nudge may show again on the next project, which is
    // the lesser harm than never showing it.
  }
}

/** A small card that suggests the extension to a reader who has spent a while
 *  on a project's notes. It appears once per visit, and only on devices that
 *  can install extensions, so phones and tablets never see it. */
export function ExtensionNudge() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (alreadyShown() || !canInstallExtensions()) return;
    const timer = window.setTimeout(() => {
      markShown();
      setOpen(true);
    }, NUDGE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!open) return null;
  const browser = browserById(detectBrowser());
  return (
    <aside
      aria-labelledby="extension-nudge-title"
      className={cn(
        cardVariants({ elevation: "floating" }),
        "fixed bottom-5 right-5 z-30 w-[22rem] max-w-[calc(100vw-2.5rem)] p-5 motion-safe:animate-[cn-rise_420ms_cubic-bezier(0.16,1,0.3,1)]",
      )}
    >
      <IconButton label="Close" onClick={() => setOpen(false)} className="absolute right-3 top-3">
        <CloseIcon size={16} />
      </IconButton>
      <div className="flex items-center gap-3 pr-6">
        <img src={logoUrl} alt="" width={36} height={36} />
        <h2 id="extension-nudge-title" className="font-title text-lg font-bold leading-snug text-fg">
          See these notes where you read
        </h2>
      </div>
      <p className="mt-3 text-sm text-fg-secondary">
        The extension shows each note right next to the claim it is about, on Substack, YouTube and LessWrong.
      </p>
      <div className="mt-4">
        {isListed(browser) ? (
          <StoreButton browser={browser} size="md">
            Add to {browser.name}, it's free
          </StoreButton>
        ) : (
          <p className="text-sm text-fg-muted">A {browser.name} version is coming soon. It works in Chrome, Firefox and Edge today.</p>
        )}
      </div>
    </aside>
  );
}
