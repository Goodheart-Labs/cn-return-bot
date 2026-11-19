import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addCorrection, evidenceLink, noteIdFromLink, removeCorrection } from "@cn/core/corrections";
import { queryKeys } from "@cn/features/query/queryKeys";
import { Button } from "@cn/ui/Button";
import { ConfirmDelete } from "@cn/ui/ConfirmDelete";
import { Input } from "@cn/ui/Field";
import { ExternalLinkIcon } from "@cn/ui/icons";
import { Page } from "@cn/ui/Page";
import { PageTitle } from "@cn/ui/typography";
import { CreatorLink } from "../components/CreatorLink";
import { NoteFeed, type FeedCard } from "../components/NoteFeed";
import { useCorrections, type CorrectionEntry } from "../lib/feedQueries";
import type { Route } from "../lib/routing";
import { useIsAdmin } from "../lib/useIsAdmin";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The form an admin adds a correction with: a link to the note, and a link
 *  that shows the author corrected the post. */
function AddCorrection({ onAdded }: { onAdded: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-2 rounded-control border border-line bg-surface-muted p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const noteId = noteIdFromLink(note);
        const url = evidenceLink(evidence);
        if (!noteId) return setError("The first field needs a link to one note (it ends in ?note=…).");
        if (!url) return setError("The second field needs an https link that shows the correction.");
        setBusy(true);
        setError(null);
        try {
          await addCorrection(noteId, url);
          setNote("");
          setEvidence("");
          await onAdded();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm font-medium text-fg">Add a correction (admins only)</p>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Link to the note" aria-label="Link to the note" className="w-full" />
      <Input
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        placeholder="Link that shows the correction, such as the author's reply"
        aria-label="Link that shows the correction"
        className="w-full"
      />
      <Button type="submit" disabled={busy || !note.trim() || !evidence.trim()}>
        Add
      </Button>
      {error && <p className="text-sm text-negative">{error}</p>}
    </form>
  );
}

/** Notes after which the author changed their post, the most recent first.
 *  Each card names its creator and links to what shows the correction. Admins
 *  add a note with that link, and can take a note off again. */
export function CorrectionsPage({ navigate }: { navigate: (route: Route) => void }) {
  const admin = useIsAdmin();
  const client = useQueryClient();
  const list = useCorrections();
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => client.invalidateQueries({ queryKey: queryKeys.corrections }), [client]);
  const byline = useCallback(
    ({ entry: { row }, note, project }: FeedCard<CorrectionEntry>) => (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {project && <CreatorLink project={project} navigate={navigate} />}
        <span className="text-sm text-fg-muted">Corrected by the author · {day(row.corrected_at)}</span>
        <a href={row.evidence_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-link hover:underline">
          See the correction
          <ExternalLinkIcon size={13} aria-hidden />
        </a>
        {admin && (
          <span className="ml-auto">
            <ConfirmDelete
              label="Take off the corrections"
              iconSize={15}
              onDelete={() => {
                setError(null);
                void removeCorrection(note.id).then(reload, (err: Error) => setError(err.message));
              }}
            />
          </span>
        )}
      </div>
    ),
    [navigate, admin, reload],
  );

  return (
    <Page width="full">
      <div className="mx-auto mb-6 max-w-[40rem] space-y-4">
        <PageTitle>Corrections</PageTitle>
        <p className="text-sm text-fg-secondary">
          Posts their authors corrected after a note. Each one links to where the author said so, or to the corrected post.
        </p>
        {admin && <AddCorrection onAdded={reload} />}
        {error && <p className="text-sm text-negative">{error}</p>}
      </div>
      <NoteFeed list={list} byline={byline} emptyText="No corrections yet." />
    </Page>
  );
}
