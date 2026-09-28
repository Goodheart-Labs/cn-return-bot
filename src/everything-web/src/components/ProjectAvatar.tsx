import { useState } from "react";
import { WEB_PROJECT_SLUG } from "@cn/core/projects";
import type { FeedProjectRow } from "@cn/core/types";
import { cn } from "@cn/ui/cn";
import { GlobeIcon } from "@cn/ui/icons";

/** A project's picture: the creator's own, or their initial when we have none
 *  or it fails to load. The catch-all "Around the web" project shows a globe. */
export function ProjectAvatar({ project, size, className }: { project: FeedProjectRow; size: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const frame = cn("shrink-0 overflow-hidden rounded-full border border-line bg-surface-muted", className);
  if (project.avatar_url && !broken) {
    return (
      <img
        src={project.avatar_url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setBroken(true)}
        className={cn(frame, "object-cover")}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span aria-hidden="true" className={cn(frame, "grid place-items-center font-title font-bold text-fg-secondary")} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {project.slug === WEB_PROJECT_SLUG ? <GlobeIcon size={size * 0.5} /> : project.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
