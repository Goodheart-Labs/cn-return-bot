import type { ProjectHeader } from "@cn/core/types";
import type { Route } from "../lib/routing";
import { ProjectAvatar } from "./ProjectAvatar";
import { RouteLink } from "./RouteLink";

/** A creator's picture and name, linking to their page of notes. */
export function CreatorLink({ project, navigate }: { project: ProjectHeader; navigate: (route: Route) => void }) {
  return (
    <RouteLink
      to={{ view: "notes", project: project.slug, item: null, note: null }}
      navigate={navigate}
      className="inline-flex items-center gap-2 text-sm font-medium text-fg-secondary hover:text-fg"
    >
      <ProjectAvatar project={project} size={22} />
      {project.name}
    </RouteLink>
  );
}
