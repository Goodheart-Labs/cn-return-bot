import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { Button, buttonVariants } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { Card } from "@cn/ui/Card";
import { Checkbox } from "@cn/ui/Field";
import { signOut } from "@cn/core/auth";
import { useSession } from "@cn/features/auth/useSession";
import { LoginPanel } from "../../components/LoginPanel";
import { BOOK_CALL_URLS, FEEDBACK_FORM_URL } from "../../utils/feedbackLinks";
import { NoteDisplayChoices, useNoteDisplay } from "../../components/NoteDisplayChoices";
import {
  getSettings,
  markWelcomeSeen,
  updateSettings,
  type ExtensionSettings,
  type SettingsPatch,
  type VisitSiteKind,
} from "../../utils/settings";

/** The settings as editable state, mirroring useNoteDisplay: optimistic local
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
  { kind: "lesswrong", label: "LessWrong and the Alignment Forum" },
];

/** The settings page's checkbox: the design system's, at this page's text
 *  size. */
const Setting = (props: ComponentProps<typeof Checkbox>) => <Checkbox className="text-sm text-fg-secondary" {...props} />;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
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
      <p className="text-sm text-fg-secondary">
        When you open a post on Substack, YouTube, LessWrong, or the Alignment Forum, the extension can save the link and
        the time. That tells us which posts are worth checking next. It is anonymous: never your
        account or the rest of your browsing. Each saved link carries a random code that is
        different for every author, so we can count how many people read an author without joining
        your reading together.
      </p>
      <Setting checked={anyOn} onChange={setAll}>
        Share which posts you open
      </Setting>
      {mixed && (
        <p className="text-sm text-fg-muted">
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
  const [display, changeDisplay] = useNoteDisplay();
  return (
    <div className="space-y-4">
      <Section title="Overlays">
        <Setting
          checked={settings.showThumbnailBadges}
          onChange={(checked) => onToggle({ showThumbnailBadges: checked })}
        >
          Show note counts on thumbnails and listings
        </Setting>
      </Section>

      <Section title="Notes">
        <p className="text-sm text-fg-secondary">Where a note opens on article pages.</p>
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <input
            type="radio"
            className="accent-primary"
            name="note-style"
            checked={settings.noteStyle === "margin"}
            onChange={() => onToggle({ noteStyle: "margin" })}
          />
          In the margin, beside the text
        </label>
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <input
            type="radio"
            className="accent-primary"
            name="note-style"
            checked={settings.noteStyle === "classic"}
            onChange={() => onToggle({ noteStyle: "classic" })}
          />
          Classic: a badge in the text, the note on top of it
        </label>
        {display && <NoteDisplayChoices display={display} onChange={changeDisplay} />}
        <p className="pt-2 text-sm text-fg-secondary">How the rating buttons look.</p>
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <input
            type="radio"
            className="accent-primary"
            name="pill-palette"
            checked={settings.pillPalette === "colourful"}
            onChange={() => onToggle({ pillPalette: "colourful" })}
          />
          Colourful: Yes in green, Somewhat in amber, No in red
        </label>
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <input
            type="radio"
            className="accent-primary"
            name="pill-palette"
            checked={settings.pillPalette === "neutral"}
            onChange={() => onToggle({ pillPalette: "neutral" })}
          />
          Neutral: all three in blue
        </label>
      </Section>

      <Section title="Sharing by site">
        {VISIT_SITES.map(({ kind, label }) => (
          <Setting
            key={kind}
            checked={settings.saveVisits[kind]}
            onChange={(checked) => onToggle({ saveVisits: { [kind]: checked } })}
          >
            Share which posts you open on {label}
          </Setting>
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
    <div className="min-h-screen bg-canvas px-4 py-8">
      <Card className="mx-auto max-w-xl p-6">
        <h1 className="mb-4 text-xl font-extrabold text-fg">Settings</h1>
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
              {session.user.email && <p className="text-sm text-fg-secondary">Signed in as {session.user.email}</p>}
              <Button variant="secondary" className="w-full" onClick={() => signOut()}>
                Sign out
              </Button>
            </div>
          ) : (
            <LoginPanel surface="settings" />
          )}
        </Section>

        <Section title="Feedback">
          <p className="text-sm text-fg-secondary">
            Common Notes is new, and we want to hear what works for you and what doesn't.
          </p>
          <a href={FEEDBACK_FORM_URL} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "link" }), "block text-sm")}>
            Send us feedback
          </a>
          <p className="text-sm text-fg-secondary">
            Or book a video call with us:{" "}
            {BOOK_CALL_URLS.map(({ label, url }, index) => (
              <span key={url}>
                {index > 0 && " or "}
                <a href={url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "link" })}>
                  {label}
                </a>
              </span>
            ))}
          </p>
        </Section>

        <section className="border-t border-line pt-4">
          <button
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            className="text-sm font-semibold text-fg"
          >
            {advancedOpen ? "Hide advanced settings" : "Advanced settings"}
          </button>
          {advancedOpen && settings && (
            <div className="mt-4">
              <AdvancedSettings settings={settings} onToggle={toggleSettings} />
            </div>
          )}
        </section>
        </div>
      </Card>
    </div>
  );
}
