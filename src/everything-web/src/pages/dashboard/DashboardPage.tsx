import { Card } from "@cn/ui/Card";
import { PageTitle } from "@cn/ui/typography";
import { AdminOnly } from "../../components/AdminOnly";
import { SidebarPagesLayout } from "../../components/SidebarLayout";
import type { Route } from "../../lib/routing";
import { AbTests } from "../notewriter/AbTests";
import { Clicks } from "./Clicks";
import { CreatorRanking } from "./CreatorRanking";
import { MetricsChart } from "./MetricsChart";
import { NotesSection } from "./NotesSection";
import { RecentPosts } from "./RecentPosts";
import { DASHBOARD_SECTIONS, type DashboardSection } from "./sections";
import { UsageChart } from "./UsageChart";

const sectionRoute = (section: DashboardSection): Route => ({ view: "dashboard", section });

/** The admins' dashboard. A sidebar lists its sections: how the extension is
 *  used, the notes by rating, the A/B tests of Common Notes, the order of the
 *  next walk, Claude's usage, the posts the pipeline finished last and the
 *  clicks towards the extension. Anyone who is not an admin sees only a short
 *  message. The numbers come from database functions that the public key may
 *  call, so hiding the page is only cosmetic. */
export function DashboardPage({ section, navigate }: { section: DashboardSection; navigate: (route: Route) => void }) {
  return (
    <AdminOnly>
      <Dashboard section={section} navigate={navigate} />
    </AdminOnly>
  );
}

function SectionContent({ section, navigate }: { section: DashboardSection; navigate: (route: Route) => void }) {
  switch (section) {
    case "metrics":
      return <Card className="p-4 sm:p-5"><MetricsChart /></Card>;
    case "notes":
      return <NotesSection />;
    case "ab-tests":
      return <AbTests source="commonnotes" />;
    case "creators":
      return <Card className="p-4 sm:p-5"><CreatorRanking navigate={navigate} /></Card>;
    case "claude-usage":
      return <Card className="p-4 sm:p-5"><UsageChart /></Card>;
    case "recent-posts":
      return <Card className="p-4 sm:p-5"><RecentPosts /></Card>;
    case "clicks":
      return <Card className="p-4 sm:p-5"><Clicks /></Card>;
  }
}

const PAGES = DASHBOARD_SECTIONS.map((s) => ({ ...s, route: sectionRoute(s.id) }));

function Dashboard({ section, navigate }: { section: DashboardSection; navigate: (route: Route) => void }) {
  const current = DASHBOARD_SECTIONS.find((s) => s.id === section)!;
  return (
    <SidebarPagesLayout storageKey="cn:dashboardSidebarWidth" label="Dashboard sections" pages={PAGES} current={section} navigate={navigate}>
      <div className="mx-auto max-w-5xl space-y-6">
        <PageTitle>{current.label}</PageTitle>
        <SectionContent section={section} navigate={navigate} />
      </div>
    </SidebarPagesLayout>
  );
}
