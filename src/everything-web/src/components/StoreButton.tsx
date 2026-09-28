import type { ReactNode } from "react";
import { NOTES, type Route } from "../lib/routing";
import { RouteLink } from "./RouteLink";
import { buttonVariants } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { trackStoreClick, type Browser, type ListedBrowser } from "../lib/extensionStores";

/** A browser's official logo. It sits next to the browser's name, which is
 *  what screen readers read, so the image itself is silent. */
export function BrowserLogo({ browser, size }: { browser: Browser; size: number }) {
  return <img src={browser.logo} alt="" width={size} height={size} className="shrink-0" />;
}

/** The main button that opens a browser's store listing, with that browser's
 *  logo. It counts the click. */
export function StoreButton({ browser, size = "lg", children }: { browser: ListedBrowser; size?: "md" | "lg"; children: ReactNode }) {
  return (
    <a
      href={browser.store.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackStoreClick(browser)}
      className={cn(buttonVariants({ variant: "primary", size }), size === "lg" ? "gap-2.5" : "gap-2")}
    >
      <BrowserLogo browser={browser} size={size === "lg" ? 22 : 18} />
      {children}
    </a>
  );
}

/** What a phone or tablet shows where a store button would be: the extension
 *  needs a computer, and the notes can be read right here. */
export function DesktopOnly({ navigate, className }: { navigate: (route: Route) => void; className?: string }) {
  return (
    <p className={cn("text-base text-fg-secondary", className)}>
      Common Notes runs in Chrome, Firefox and Edge on a computer. You can{" "}
      <RouteLink to={NOTES} navigate={navigate} className={buttonVariants({ variant: "link" })}>
        read the notes here
      </RouteLink>
      .
    </p>
  );
}
