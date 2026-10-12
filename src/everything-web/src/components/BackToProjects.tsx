import { PreviousIcon } from "@cn/ui/icons";
import { NOTES, type Route } from "../lib/routing";
import { RouteLink } from "./RouteLink";

/** The link back to the overview of all projects. */
export function BackToProjects({ navigate }: { navigate: (route: Route) => void }) {
  return (
    <RouteLink to={NOTES} navigate={navigate} className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
      <PreviousIcon size={16} aria-hidden="true" />
      All projects
    </RouteLink>
  );
}
