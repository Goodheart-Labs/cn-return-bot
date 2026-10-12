import logoUrl from "@cn/ui/assets/logo.svg";
import { buttonVariants } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { HOME, INSTALL, MINISITES, NOTES, type Route } from "../lib/routing";
import { AuthCorner } from "./AuthCorner";
import { RouteLink } from "./RouteLink";

const navLink =
  "rounded-control text-sm font-medium text-fg-secondary hover:text-fg aria-[current=page]:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2";

/** The bar at the top of every page. The name and the four pages sit on the
 *  left, signing in and getting the extension on the right. Getting the
 *  extension leads to the homepage's install section. */
export function SiteHeader({ route, navigate, onSignIn }: { route: Route; navigate: (route: Route) => void; onSignIn: () => void }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface">
      {/* On a phone the tabs take a second row, because they do not fit
          beside the name and Sign in. From sm up the header is one row,
          3.5rem tall, which the project page's side panel relies on. */}
      <div className="mx-auto flex max-w-[96rem] flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2 sm:h-14 sm:flex-nowrap sm:gap-6 sm:px-4 sm:py-0 md:px-8">
        <RouteLink to={HOME} navigate={navigate} className="flex shrink-0 items-center gap-2 font-title text-sm font-bold text-fg sm:text-base">
          <img src={logoUrl} alt="" width={26} height={26} />
          Common Notes
        </RouteLink>
        <nav aria-label="Main" className="order-last flex w-full items-center gap-5 sm:order-none sm:w-auto">
          <RouteLink to={HOME} navigate={navigate} current={route.view === "home"} className={navLink}>
            Home
          </RouteLink>
          <RouteLink to={NOTES} navigate={navigate} current={route.view === "notes"} className={navLink}>
            Notes
          </RouteLink>
          <RouteLink to={MINISITES} navigate={navigate} current={route.view === "minisites" || route.view === "newMinisite"} className={navLink}>
            Minisites
          </RouteLink>
          <RouteLink to={{ view: "leaderboard" }} navigate={navigate} current={route.view === "leaderboard"} className={navLink}>
            Leaderboard
          </RouteLink>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <AuthCorner onSignIn={onSignIn} />
          <RouteLink to={INSTALL} navigate={navigate} className={cn(buttonVariants({ variant: "primary" }), "hidden sm:inline-flex")}>
            Get the extension
          </RouteLink>
        </div>
      </div>
    </header>
  );
}
