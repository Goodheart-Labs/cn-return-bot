import type { ReactNode } from "react";
import { Card } from "@cn/ui/Card";
import { AdminOnly } from "../../components/AdminOnly";
import type { Route } from "../../lib/routing";
import { CreatorRanking } from "./CreatorRanking";
import { MetricsChart } from "./MetricsChart";
import { RecentPosts } from "./RecentPosts";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-title text-xl font-bold text-fg">{title}</h2>
      <Card className="p-4 sm:p-5">{children}</Card>
    </section>
  );
}

/** The admins' dashboard: how the extension is used, the order of the next
 *  walk, and the posts the pipeline finished last. Anyone who is not an admin
 *  sees only a short message. The numbers come from database functions that
 *  the public key may call, so hiding the page is only cosmetic. */
export function DashboardPage({ navigate }: { navigate: (route: Route) => void }) {
  return (
    <AdminOnly>
      <Dashboard navigate={navigate} />
    </AdminOnly>
  );
}

function Dashboard({ navigate }: { navigate: (route: Route) => void }) {
  return (
    <main className="mx-auto max-w-5xl space-y-10 px-4 py-8 md:px-8">
      <h1 className="font-title text-3xl font-bold text-fg">Dashboard</h1>
      <Section title="Metrics">
        <MetricsChart />
      </Section>
      <Section title="Creator ranking">
        <CreatorRanking navigate={navigate} />
      </Section>
      <Section title="Recently checked posts">
        <RecentPosts />
      </Section>
    </main>
  );
}
