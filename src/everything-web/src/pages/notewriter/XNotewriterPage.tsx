import { useEffect } from "react";
import type { FieldDef } from "@cn/core/fieldQuery";
import { useFieldQuery } from "@cn/features/fieldQuery/useFieldQuery";
import { createLocalPreference } from "@cn/features/hooks/createLocalPreference";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { Page } from "@cn/ui/Page";
import { Switch } from "@cn/ui/Switch";
import { PageTitle } from "@cn/ui/typography";
import { SidebarPagesLayout } from "../../components/SidebarLayout";
import { X_AB_TESTS, X_NOTEWRITER, type Route } from "../../lib/routing";
import { AbTests } from "./AbTests";
import { abTestFields, DEFAULT_NOTE_QUERY, NOTE_FIELDS } from "./noteFields";
import { Overview } from "./Overview";
import { useAbTests } from "./queries";

type XPage = "overview" | "abTests";

const PAGES: { id: XPage; label: string; route: Route }[] = [
  { id: "overview", label: "Overview", route: X_NOTEWRITER },
  { id: "abTests", label: "A/B tests", route: X_AB_TESTS },
];

/** Developer mode is remembered on the device. */
const useDeveloperMode = createLocalPreference<boolean>("cn:xNotewriterDeveloperMode", {
  parse: (raw) => raw === "true",
  serialize: String,
});

/** The Overview with its filters and sorts, which live in the page address.
 *  The fields are fixed for the life of the query, so the page mounts it anew
 *  when developer mode adds or takes away the A/B test fields. */
function OverviewWithQuery({ fields, devMode }: { fields: readonly FieldDef[]; devMode: boolean }) {
  const [query, setQuery] = useFieldQuery({ storageKey: "cn:xNotewriterQuery", fields, displayOptions: [], defaults: DEFAULT_NOTE_QUERY });
  return <Overview fields={fields} query={query} onQueryChange={setQuery} devMode={devMode} />;
}

/** The X notewriter page: our AI-written Community Notes on X. Everyone sees
 *  the headline numbers, the chart and the notes. Developer mode opens a
 *  sidebar with two pages. The Overview adds the A/B test filters and the
 *  Ratio chart, and the A/B tests page compares the arms of the tests. A link
 *  to the A/B tests page turns developer mode on. */
export function XNotewriterPage({ page, navigate }: { page: XPage; navigate: (route: Route) => void }) {
  const [devMode, setDevMode] = useDeveloperMode();
  useEffect(() => {
    if (page === "abTests" && !devMode) setDevMode(true);
  }, [page, devMode, setDevMode]);
  const tests = useAbTests("x", devMode);
  const switchDeveloperMode = (on: boolean) => {
    setDevMode(on);
    if (!on && page === "abTests") navigate(X_NOTEWRITER);
  };

  const header = (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
      <PageTitle>{page === "abTests" ? "A/B tests" : "AI written Community Notes"}</PageTitle>
      <Switch label="Developer mode" checked={devMode} onChange={switchDeveloperMode} />
    </div>
  );
  const content =
    page === "abTests" ? (
      <AbTests source="x" />
    ) : !devMode ? (
      <OverviewWithQuery key="public" fields={NOTE_FIELDS.x} devMode={false} />
    ) : tests.isError ? (
      <LoadFailed what="The A/B tests" onRetry={() => void tests.refetch()} />
    ) : !tests.data ? (
      <p className="text-sm text-fg-muted">Loading…</p>
    ) : (
      <OverviewWithQuery key="developer" fields={[...NOTE_FIELDS.x, ...abTestFields(tests.data)]} devMode />
    );

  if (!devMode)
    return (
      <Page>
        {header}
        {content}
      </Page>
    );
  return (
    <SidebarPagesLayout storageKey="cn:xNotewriterSidebarWidth" label="X notewriter pages" pages={PAGES} current={page} navigate={navigate}>
      <div className="mx-auto max-w-5xl">
        {header}
        {content}
      </div>
    </SidebarPagesLayout>
  );
}
