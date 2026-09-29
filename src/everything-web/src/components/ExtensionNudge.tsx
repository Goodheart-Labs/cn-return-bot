import { useEffect, useState } from "react";
import { buttonVariants } from "@cn/ui/Button";
import { Modal } from "@cn/ui/Modal";
import { canInstallExtensions, extensionInstalled } from "../lib/extensionStores";
import { INSTALL, type Route } from "../lib/routing";
import { RouteLink } from "./RouteLink";

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

/** A popup that suggests the extension to a reader who has spent a while on a
 *  project's notes. It appears once per visit, never to a reader who already
 *  has the extension, and only on devices that can install one, so phones and
 *  tablets never see it. */
export function ExtensionNudge({ navigate }: { navigate: (route: Route) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (alreadyShown() || !canInstallExtensions()) return;
    const timer = window.setTimeout(() => {
      if (extensionInstalled()) return;
      markShown();
      setOpen(true);
    }, NUDGE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!open) return null;
  return (
    <Modal title="Want to see Common Notes in the wild?" onClose={() => setOpen(false)}>
      <RouteLink
        to={INSTALL}
        navigate={(route) => {
          setOpen(false);
          navigate(route);
        }}
        className={buttonVariants({ variant: "primary" })}
      >
        Get the extension
      </RouteLink>
    </Modal>
  );
}
