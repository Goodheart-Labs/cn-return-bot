import logoUrl from "@cn/ui/assets/logo.svg";
import { buttonVariants } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { HOME, INSTALL, NOTES, type Route } from "../lib/routing";
import { AuthCorner } from "./AuthCorner";
import { RouteLink } from "./RouteLink";

const navLink = "text-sm font-medium text-fg-secondary hover:text-fg aria-[current=page]:text-fg";

/** The bar at the top of every page. The name and the two pages sit on the
 *  left, signing in and getting the extension on the right. Getting the
 *  extension leads to the homepage's install section. */
export function SiteHeader({ route, navigate, onSignIn }: { route: Route; navigate: (route: Route) => void; onSignIn: () => void }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-[96rem] items-center gap-2.5 px-3 sm:gap-6 sm:px-4 md:px-8">
        <RouteLink to={HOME} navigate={navigate} className="flex shrink-0 items-center gap-2 text-sm font-extrabold text-fg sm:text-base">
          <img src={logoUrl} alt="" width={26} height={26} />
          Common Notes
        </RouteLink>
        <nav aria-label="Main" className="flex items-center gap-3 sm:gap-5">
          <RouteLink to={HOME} navigate={navigate} current={route.view === "home"} className={navLink}>
            Home
          </RouteLink>
          <RouteLink to={NOTES} navigate={navigate} current={route.view === "notes"} className={navLink}>
            Notes
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
