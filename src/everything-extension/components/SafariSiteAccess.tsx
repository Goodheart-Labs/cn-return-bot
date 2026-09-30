import { useEffect, useState } from "react";
import { browser } from "#imports";
import { Button } from "@cn/ui/Button";

const EVERY_WEBSITE = { origins: ["<all_urls>"] };

/** Whether Safari lets the extension run on every website. Null while the
 *  first answer is on its way. Safari grants no site at install, and the user
 *  can change the grant at any time from the toolbar or Safari's settings, so
 *  the answer is read again whenever a grant changes and whenever the reader
 *  comes back to this tab. */
function useEveryWebsiteAccess(): boolean | null {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    const read = () => void browser.permissions.contains(EVERY_WEBSITE).then(setGranted);
    read();
    browser.permissions.onAdded.addListener(read);
    browser.permissions.onRemoved.addListener(read);
    window.addEventListener("focus", read);
    return () => {
      browser.permissions.onAdded.removeListener(read);
      browser.permissions.onRemoved.removeListener(read);
      window.removeEventListener("focus", read);
    };
  }, []);
  return granted;
}

/** Asks a Safari user to allow Common Notes on every website, and says so once
 *  they have. Chrome and Firefox grant every site at install, so only the
 *  Safari build renders this. Without the grant none of our code runs on a
 *  page: no notes, no badges, no visit counting. */
export function SafariSiteAccess() {
  const granted = useEveryWebsiteAccess();
  if (granted === null) return null;
  if (granted) return <p className="text-sm font-medium text-positive">Done. Common Notes can see every website.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-fg-secondary">
        Safari asks you to allow extensions one site at a time. Click the Common Notes button in the toolbar and
        choose Always Allow on Every Website. If you skip this, notes only appear on sites you allow one by one.
      </p>
      {/* Safari answers this request with its own prompt, which carries the
          Always Allow on Every Website choice. */}
      <Button onClick={() => void browser.permissions.request(EVERY_WEBSITE)}>Allow on every website</Button>
    </div>
  );
}
