import { useEffect, useState, type ReactNode } from "react";
import { browser } from "#imports";
import { CARD, QUIET_LINK, SECONDARY_BUTTON } from "../../../everything-shared/ui";
import { signOut, useSession } from "../../../everything-shared/auth";
import { LoginPanel } from "../../components/LoginPanel";
import { NoteFilterToggles, useNoteFilters } from "../../components/NoteFilterToggles";
import {
  getSettings,
  markWelcomeSeen,
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

/** The one visit-recording choice on the main page. It stands for all three
 *  sites at once: ticking it turns every site on, unticking turns every site
 *  off. A mixed per-site state, set in the advanced section, reads as on with
 *  a hint saying so. */
function VisitRecordingChoice({ settings, onToggle }: {
  settings: ExtensionSettings;
  onToggle: (patch: SettingsPatch) => void;
}) {
  const states = VISIT_SITES.map(({ kind }) => settings.saveVisits[kind]);
  const anyOn = states.some(Boolean);
  const mixed = anyOn && !states.every(Boolean);
  const setAll = (checked: boolean) =>
    onToggle({ saveVisits: { substack: checked, youtube: checked, lesswrong: checked } });
  return (
    <>
      <p className="text-sm text-gray-600">
        When you open a post on Substack, YouTube, or LessWrong, the extension can save the link and
        the time. That tells us which posts are worth checking next. It is anonymous: never your
        account or the rest of your browsing.
      </p>
      <Checkbox checked={anyOn} onChange={setAll}>
        Share which posts you open
      </Checkbox>
      {mixed && (
        <p className="text-sm text-gray-500">
          You have turned this off for some sites. The per-site choices are in the advanced settings.
        </p>
      )}
    </>
  );
}

/** The rarely needed choices, folded away so the settings page stays small. */
function AdvancedSettings({ settings, onToggle }: {
  settings: ExtensionSettings;
  onToggle: (patch: SettingsPatch) => void;
}) {
  const [filters, toggleFilters] = useNoteFilters();
  return (
    <div className="space-y-4">
      <Section title="Overlays">
        <Checkbox
          checked={settings.showNoteCountOverlay}
          onChange={(checked) => onToggle({ showNoteCountOverlay: checked })}
        >
          Show the note-count card on pages that have been checked
        </Checkbox>
        <Checkbox
          checked={settings.showThumbnailBadges}
          onChange={(checked) => onToggle({ showThumbnailBadges: checked })}
        >
          Show note counts on thumbnails and listings
        </Checkbox>
      </Section>

      <Section title="Notes">
        <p className="text-sm text-gray-600">Where a note opens on article pages.</p>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="radio"
            name="note-style"
            checked={settings.noteStyle === "margin"}
            onChange={() => onToggle({ noteStyle: "margin" })}
          />
          In the margin, beside the text
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="radio"
            name="note-style"
            checked={settings.noteStyle === "classic"}
            onChange={() => onToggle({ noteStyle: "classic" })}
          />
          Classic: a badge in the text, the note on top of it
        </label>
        {filters && <NoteFilterToggles filters={filters} onToggle={toggleFilters} />}
      </Section>

      <Section title="Sharing by site">
        {VISIT_SITES.map(({ kind, label }) => (
          <Checkbox
            key={kind}
            checked={settings.saveVisits[kind]}
            onChange={(checked) => onToggle({ saveVisits: { [kind]: checked } })}
          >
            Share which posts you open on {label}
          </Checkbox>
        ))}
      </Section>
    </div>
  );
}

export function SettingsApp() {
  const [settings, toggleSettings] = useExtensionSettings();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { session, ready } = useSession();
  // Seeing this page counts as having been welcomed: the sharing choice above
  // is the welcome page's question in more detail. A user who found the
  // settings on their own therefore stops being greeted, and recording obeys
  // their checkboxes from here on.
  useEffect(() => {
    void markWelcomeSeen();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className={`${CARD} mx-auto max-w-xl p-6`}>
        <h1 className="mb-4 text-xl font-extrabold text-gray-900">Settings</h1>
        <div className="space-y-4">

        <Section title="Help us decide what to check">
          {settings && <VisitRecordingChoice settings={settings} onToggle={toggleSettings} />}
        </Section>

        <Section title="Account">
          {/* An anonymous session is invisible to the reader: it exists only so
              their votes have an account to live on. This section keeps
              offering the real sign-in, which upgrades that account in place. */}
          {!ready ? null : session && !session.user.is_anonymous ? (
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

        <section className="border-t border-gray-200 pt-4">
          <button
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            className="text-sm font-semibold text-gray-900"
          >
            {advancedOpen ? "Hide advanced settings" : "Advanced settings"}
          </button>
          {advancedOpen && settings && (
            <div className="mt-4">
              <AdvancedSettings settings={settings} onToggle={toggleSettings} />
            </div>
          )}
        </section>

        <section className="border-t border-gray-200 pt-4">
          <button
            onClick={() => void browser.tabs.create({ url: browser.runtime.getURL("/welcome.html") })}
            className={`text-sm ${QUIET_LINK}`}
          >
            Show the welcome again
          </button>
        </section>
        </div>
      </div>
    </div>
  );
}
