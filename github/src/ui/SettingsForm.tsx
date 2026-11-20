// All settings, shown in the toolbar popup. Every change is saved at once and
// open GitHub tabs follow it live.
import { useEffect, useState } from 'preact/hooks';
import {
  DEFAULT_SETTINGS,
  PAGE_WIDTHS,
  RECENT_MAX,
  RECENT_MIN,
  REPO_LAYOUTS,
  REPO_SORTS,
  type Settings,
  loadSettings,
  saveSettings,
} from '../settings.ts';
import { TWEAKS, TWEAK_GROUPS, tweakEnabled } from '../tweaks.ts';

export function SettingsForm() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  if (!settings) return null;

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    void saveSettings(next);
  };

  const toggle = (key: keyof Settings, label: string, hint?: string) => (
    <Check label={label} hint={hint} checked={settings[key] as boolean} onChange={(v) => update({ [key]: v })} />
  );

  const choice = <K extends 'pageWidth' | 'repoLayout' | 'repoSort'>(key: K, label: string, options: Record<Settings[K], string>) => (
    <label class="hb-field">
      <span class="hb-check-label">{label}</span>
      <select class="hb-input" value={settings[key]} onChange={(e) => update({ [key]: e.currentTarget.value } as Partial<Settings>)}>
        {Object.entries<string>(options).map(([value, text]) => (
          <option value={value} key={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div class="hb-settings">
      <section class="hb-set-section">
        {toggle('replaceHome', 'Replace the GitHub homepage', 'Off gives you the normal GitHub feed back.')}
        {toggle('sideMenuRecent', 'Recently pushed in the ☰ side menu', 'Instead of "Top repositories", on every GitHub page.')}
      </section>

      <section class="hb-set-section">
        <h2>Layout</h2>
        {choice('pageWidth', 'Page width', PAGE_WIDTHS)}
        {choice('repoLayout', 'Repositories as', REPO_LAYOUTS)}
        {choice('repoSort', 'Sort repositories by', REPO_SORTS)}
      </section>

      <section class="hb-set-section">
        <h2>Sections</h2>
        {toggle('showQuickLinks', 'Quick links', 'Pull requests, issues, notifications, stars, profile.')}
        {toggle('showOrgs', 'Organizations')}
        {toggle('showRecent', 'Recently pushed')}
        <label class="hb-field hb-indent">
          <span class="hb-check-label">How many (homepage and ☰ menu)</span>
          <input
            class="hb-input hb-input-small"
            type="number"
            min={RECENT_MIN}
            max={RECENT_MAX}
            value={settings.recentCount}
            onChange={(e) => {
              const n = parseInt(e.currentTarget.value, 10);
              update({ recentCount: Math.min(RECENT_MAX, Math.max(RECENT_MIN, Number.isNaN(n) ? DEFAULT_SETTINGS.recentCount : n)) });
            }}
          />
        </label>
        {toggle('showRepos', 'All repositories')}
        <Check label="Show forks" checked={!settings.hideForks} onChange={(v) => update({ hideForks: !v })} indent />
        <Check label="Show archived repositories" checked={!settings.hideArchived} onChange={(v) => update({ hideArchived: !v })} indent />
      </section>

      {TWEAK_GROUPS.map((group) => (
        <section class="hb-set-section" key={group}>
          <h2>Declutter: {group.toLowerCase()}</h2>
          {TWEAKS.filter((t) => t.group === group).map((t) => (
            <Check
              key={t.id}
              label={t.label}
              hint={t.hint}
              checked={tweakEnabled(settings.tweaks, t)}
              onChange={(v) => update({ tweaks: { ...settings.tweaks, [t.id]: v } })}
            />
          ))}
        </section>
      ))}

      <section class="hb-set-section">
        <button class="hb-btn" type="button" onClick={() => update({ ...DEFAULT_SETTINGS, tweaks: {} })}>
          Reset to defaults
        </button>
      </section>
    </div>
  );
}

function Check(props: { label: string; hint?: string | undefined; checked: boolean; onChange: (v: boolean) => void; indent?: boolean }) {
  return (
    <label class={props.indent ? 'hb-check hb-indent' : 'hb-check'}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)} />
      <span>
        <span class="hb-check-label">{props.label}</span>
        {props.hint && <span class="hb-hint">{props.hint}</span>}
      </span>
    </label>
  );
}
