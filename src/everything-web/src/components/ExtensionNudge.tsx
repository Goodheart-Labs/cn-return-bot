import { useEffect, useState } from "react";
import { buttonVariants } from "@cn/ui/Button";
import { Modal } from "@cn/ui/Modal";
import { canInstallExtensions, extensionInstalled } from "../lib/extensionStores";
import { INSTALL, type Route } from "../lib/routing";
import { useVisibleFor } from "../lib/useVisibleFor";
import { RouteLink } from "./RouteLink";

/** How long a reader looks at the website's pages, summed across pages,
 *  before the nudge appears. */
const NUDGE_DELAY_MS = 60_000;

/** How often the nudge checks again whether another dialog has closed. */
const DIALOG_RECHECK_MS = 1_000;

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
    // Without storage the nudge may show again after a reload, which is the
    // lesser harm than never showing it.
  }
}

/** Every page counts towards the nudge except the homepage, which pitches the
 *  extension itself. A page added later counts without anyone adding it here. */
const countsTowardsNudge = (route: Route) => route.view !== "home";

const anotherDialogOpen = () => document.querySelector("dialog[open]") !== null;

/** A popup that suggests the extension to a reader who has spent a minute on
 *  the website. It lives in the app's frame, so the time adds up across pages.
 *  It appears once per visit, never to a reader who already has the extension,
 *  and only on devices that can install one, so phones and tablets never see
 *  it. It never covers another dialog, such as a note being written, and waits
 *  for that dialog to close instead. */
export function ExtensionNudge({ route, navigate }: { route: Route; navigate: (route: Route) => void }) {
  const [open, setOpen] = useState(false);
  const counting = countsTowardsNudge(route) && !alreadyShown() && canInstallExtensions() && !extensionInstalled();
  const timeUp = useVisibleFor(NUDGE_DELAY_MS, counting);

  useEffect(() => {
    if (!timeUp || !counting) return;
    const showOnceNoDialogIsOpen = () => {
      if (anotherDialogOpen()) return;
      window.clearInterval(recheck);
      markShown();
      setOpen(true);
    };
    const recheck = window.setInterval(showOnceNoDialogIsOpen, DIALOG_RECHECK_MS);
    showOnceNoDialogIsOpen();
    return () => window.clearInterval(recheck);
  }, [timeUp, counting]);

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
