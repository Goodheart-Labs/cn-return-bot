/** The sections of the admin dashboard, in the order of its sidebar. Each has
 *  its own address under /admin/dashboard, and the first is the plain one. */
export const DASHBOARD_SECTIONS = [
  { id: "metrics", label: "Metrics" },
  { id: "notes", label: "Notes" },
  { id: "ab-tests", label: "A/B tests" },
  { id: "creators", label: "Creator ranking" },
  { id: "claude-usage", label: "Claude note writer usage" },
  { id: "recent-posts", label: "Recently checked posts" },
  { id: "clicks", label: "Clicks towards the extension" },
] as const;

export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number]["id"];

export const isDashboardSection = (value: string | undefined): value is DashboardSection => DASHBOARD_SECTIONS.some((section) => section.id === value);
