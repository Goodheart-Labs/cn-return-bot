import { useEffect, useState, type ReactNode } from "react";
import { CARD, SECONDARY_BUTTON } from "../../../everything-shared/ui";
import { signOut, useSession } from "../../../everything-shared/auth";
import { LoginPanel } from "../../components/LoginPanel";
import { NoteFilterToggles, useNoteFilters } from "../../components/NoteFilterToggles";
import {
  getSettings,
  markSettingsOnboardingDone,
  updateSettings,
  type ExtensionSettings,
  type SettingsPatch,
  type VisitSiteKind,
} from "../../utils/settings";

/** The settings as editable state, mirroring useNoteFilters: optimistic local
 *  update, then a fire-and-forget write to synced storage. */
function useExtensionSettings(): [ExtensionSettings | null, (patch: SettingsPatch) => void] {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  useEffect(() => {
    getSettings().then(setSettings);
  }, []);
  const toggle = (patch: SettingsPatch) => {
    setSettings((prev) =>
      prev ? { ...prev, ...patch, saveVisits: { ...prev.saveVisits, ...patch.saveVisits } } : prev,
    );
    void updateSettings(patch);
  };
  return [settings, toggle];
}

const VISIT_SITES: { kind: VisitSiteKind; label: string }[] = [
  { kind: "substack", label: "Substack" },
  { kind: "youtube", label: "YouTube" },
  { kind: "lesswrong", label: "LessWrong" },
];

function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t border-gray-200 pt-4 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsApp() {
  const [settings, toggleSettings] = useExtensionSettings();
  const [filters, toggleFilters] = useNoteFilters();
  const { session, ready } = useSession();
  // Seeing this page is what the onboarding flag means, however the user got
  // here. The background sets it too, but a dev reload never fires
  // onInstalled, and a user can find the settings on their own.
  useEffect(() => {
    void markSettingsOnboardingDone();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className={`${CARD} mx-auto max-w-xl p-6`}>
        <h1 className="mb-4 text-xl font-extrabold text-gray-900">Settings</h1>
        <div className="space-y-4">

        <Section title="Visit recording">
          <p className="text-sm text-gray-600">
            On these sites, the extension saves visits whenever you open a post, so that we know which
            posts we should run our pipeline on. A visit is anonymous: just the link and the time, never
            your account or the rest of your browsing. Untick a site to record nothing there.
          </p>
          {settings &&
            VISIT_SITES.map(({ kind, label }) => (
              <Checkbox
                key={kind}
                checked={settings.saveVisits[kind]}
                onChange={(checked) => toggleSettings({ saveVisits: { [kind]: checked } })}
              >
                Save visits on {label}
              </Checkbox>
            ))}
        </Section>

        <Section title="Overlays">
          {settings && (
            <>
              <Checkbox
                checked={settings.showNoteCountOverlay}
                onChange={(checked) => toggleSettings({ showNoteCountOverlay: checked })}
              >
                Show the note-count card on pages that have been checked
              </Checkbox>
              <Checkbox
                checked={settings.showThumbnailBadges}
                onChange={(checked) => toggleSettings({ showThumbnailBadges: checked })}
              >
                Show note counts on thumbnails and listings
              </Checkbox>
            </>
          )}
        </Section>

        <Section title="Notes">
          {filters && <NoteFilterToggles filters={filters} onToggle={toggleFilters} />}
        </Section>

        <Section title="Account">
          {!ready ? null : session ? (
            <div className="space-y-2">
              {session.user.email && <p className="text-sm text-gray-600">Signed in as {session.user.email}</p>}
              <button onClick={() => signOut()} className={`w-full ${SECONDARY_BUTTON}`}>
                Sign out
              </button>
            </div>
          ) : (
            <LoginPanel surface="settings" />
          )}
        </Section>
        </div>
      </div>
    </div>
  );
}
