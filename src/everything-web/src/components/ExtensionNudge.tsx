import { useEffect, useState } from "react";
import { matchMutation, useQueryClient } from "@tanstack/react-query";
import { mutationKeys } from "@cn/features/query/queryKeys";
import { buttonVariants } from "@cn/ui/Button";
import { Modal } from "@cn/ui/Modal";
import { canInstallExtensions, extensionInstalled } from "../lib/extensionStores";
import { INSTALL, type Route } from "../lib/routing";
import { useVisibleFor } from "../lib/useVisibleFor";
import { RouteLink } from "./RouteLink";

/** How long after a reader's first vote the nudge appears. Only time spent
 *  looking at the website's pages counts, summed across pages. A reader who
 *  has just voted is curious about the notes, which makes it a good moment to
 *  suggest the extension. */
const NUDGE_DELAY_MS = 15_000;

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

/** Whether the reader has cast a vote since the website loaded. It watches the
 *  query client's mutation cache, where every vote is filed under the `vote`
 *  key, and it stays true once a vote has been saved. */
function useHasVoted(): boolean {
  const client = useQueryClient();
  const [voted, setVoted] = useState(false);
  useEffect(
    () =>
      client.getMutationCache().subscribe((event) => {
        if (event.type === "updated" && event.action.type === "success" && matchMutation({ mutationKey: mutationKeys.vote }, event.mutation)) {
          setVoted(true);
        }
      }),
    [client],
  );
  return voted;
}

/** A popup that suggests the extension to a reader 15 seconds after their
 *  first vote. A reader who never votes never sees it. It lives in the app's
 *  frame, so the time adds up across pages.
 *  It appears once per visit, never to a reader who already has the extension,
 *  and only on devices that can install one, so phones and tablets never see
 *  it. It never covers another dialog, such as a note being written, and waits
 *  for that dialog to close instead. */
export function ExtensionNudge({ route, navigate }: { route: Route; navigate: (route: Route) => void }) {
  const [open, setOpen] = useState(false);
  const voted = useHasVoted();
  const counting = voted && countsTowardsNudge(route) && !alreadyShown() && canInstallExtensions() && !extensionInstalled();
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
