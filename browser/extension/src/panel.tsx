// The threads sidebar in the browser's own side panel (Chrome sidePanel,
// Firefox sidebar), so the page gets narrower instead of being covered, like
// DevTools docked to the side. It follows the active tab of its window and
// talks to that tab's overlay for hover outlines and "Go to".
import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { pageKey, type Comment } from '@brm/shared';
import css from './content/styles.css';
import { bridge } from './content/bridge.ts';
import { Sidebar } from './content/ui/Sidebar.tsx';
import {
  SITE_ACCESS_KEY,
  SITES_KEY,
  canTurnOn,
  isAllowed,
  isWebUrl,
  originOf,
  toSiteAccess,
  toSites,
  type SiteSettings,
} from './sites.ts';
import { PANEL_FOCUS_KEY, type GoToResponse, type PanelRequest, type TabRequest } from './messages.ts';

/** Firefox closes its sidebar with this; Chrome's panel closes with window.close(). */
const sidebarAction = (chrome as unknown as { sidebarAction?: { close(): Promise<void> } }).sidebarAction;

interface ActiveTab {
  id: number;
  url: string;
}

function useActiveTab(windowId: number): ActiveTab | null {
  const [tab, setTab] = useState<ActiveTab | null>(null);
  useEffect(() => {
    const refresh = async () => {
      const [t] = await chrome.tabs.query({ active: true, windowId });
      setTab(t?.id !== undefined ? { id: t.id, url: t.url ?? '' } : null);
    };
    void refresh();
    const onActivated = (info: { windowId: number }) => {
      if (info.windowId === windowId) void refresh();
    };
    // Also fires for SPA navigation (history.pushState).
    const onUpdated = (tabId: number, info: { url?: string }, t: chrome.tabs.Tab) => {
      if (t.active && t.windowId === windowId && info.url !== undefined) setTab({ id: tabId, url: info.url });
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [windowId]);
  return tab;
}

/** Strict mode and the sites turned on, live (the help page or the icon change them). */
function useSiteSettings(): SiteSettings | null {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  useEffect(() => {
    const read = () =>
      void chrome.storage.local
        .get([SITE_ACCESS_KEY, SITES_KEY])
        .then((r) => setSettings({ access: toSiteAccess(r[SITE_ACCESS_KEY]), sites: toSites(r[SITES_KEY]) }));
    read();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && (SITE_ACCESS_KEY in changes || SITES_KEY in changes)) read();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return settings;
}

function close(): void {
  if (sidebarAction) void sidebarAction.close();
  else window.close();
}

function sendToTab<T>(tabId: number, req: TabRequest): Promise<T> {
  return chrome.tabs.sendMessage(tabId, req) as Promise<T>;
}

function PanelApp({ windowId }: { windowId: number }) {
  const tab = useActiveTab(windowId);
  const settings = useSiteSettings();
  const allowed = tab !== null && settings !== null && isAllowed(tab.url, settings);
  const { origin, path } = allowed ? pageKey(tab.url) : { origin: '', path: '' };
  const [comments, setComments] = useState<Comment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [focusId, setFocusId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!origin) {
      setComments([]);
      return;
    }
    try {
      setComments(await bridge.listComments(origin));
      setLoaded(true);
    } catch {
      // background restarting: the next event loads again
    }
  }, [origin]);

  // The port also tells the background this window's panel is open.
  useEffect(() => {
    void load();
    return bridge.subscribe((ev) => {
      if (ev.type === 'status') setConnected(ev.connected);
      else if (ev.type === 'comments-changed' && ev.origin === origin) void load();
    }, `brm-panel:${windowId}`);
  }, [origin, load, windowId]);

  // A thread to show, from a pin or "Open thread" in the page.
  useEffect(() => {
    const apply = (value: unknown) => {
      const id = (value as { id?: unknown } | undefined)?.id;
      if (typeof id !== 'number') return;
      void chrome.storage.session.remove(PANEL_FOCUS_KEY);
      setFocusId(null);
      setTimeout(() => setFocusId(id), 0); // the same id can be focused twice
    };
    void chrome.storage.session.get(PANEL_FOCUS_KEY).then((r) => apply(r[PANEL_FOCUS_KEY]));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[PANEL_FOCUS_KEY]?.newValue) apply(changes[PANEL_FOCUS_KEY].newValue);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  // The extension icon or Alt+Shift+T closes us through the background.
  useEffect(() => {
    const onMessage = (req: PanelRequest) => {
      if (req.type === 'panel-close' && req.windowId === windowId) close();
      return false;
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [windowId]);

  if (!allowed || !tab) {
    return (
      <aside class="brm-ui brm-sidebar is-docked" aria-label="Review threads">
        <header class="brm-side-head">
          <strong>Review</strong>
          <span class="brm-spacer" />
          <button class="brm-icon-btn" title="Help" onClick={() => bridge.openHelp()}>
            ?
          </button>
          <button class="brm-icon-btn" title="Close" onClick={close}>
            ✕
          </button>
        </header>
        <NotHere tab={tab} settings={settings} />
      </aside>
    );
  }

  return (
    <Sidebar
      docked
      comments={comments}
      path={path}
      connected={connected}
      focusId={loaded ? focusId : null}
      onClose={close}
      onHover={(id) => void sendToTab(tab.id, { type: 'hover', id }).catch(() => {})}
      onGoTo={async (c) => {
        try {
          const res = await sendToTab<GoToResponse | undefined>(tab.id, { type: 'go-to', comment: c });
          return res?.note ?? null;
        } catch {
          // No overlay in the tab (loaded before the extension): just open the page.
          await chrome.tabs.update(tab.id, { url: c.url });
          return null;
        }
      }}
      onOpenPage={(c) => void chrome.tabs.update(tab.id, { url: c.url })}
      onChanged={load}
    />
  );
}

/** Why there are no threads for this tab, and what to do about it. */
function NotHere({ tab, settings }: { tab: ActiveTab | null; settings: SiteSettings | null }) {
  if (!settings) return null;
  if (tab && canTurnOn(tab.url, settings)) {
    return (
      <div class="brm-panel-empty">
        <strong>Browser Review is off on this site</strong>
        <p>
          Turn it on for <code>{originOf(tab.url)}</code> to review it. It stays on for this site until you remove it on
          the help page.
        </p>
        <button
          class="brm-btn brm-primary"
          onClick={() => void chrome.runtime.sendMessage({ type: 'turn-on', tabId: tab.id }).catch(() => {})}
        >
          Turn on for this site
        </button>
      </div>
    );
  }
  if (tab && isWebUrl(tab.url) && settings.access === 'local') {
    return (
      <div class="brm-panel-empty">
        <strong>Strict mode is on</strong>
        <p>
          Browser Review only runs on localhost, 127.0.0.1 and [::1]. To use it on other sites, change{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), bridge.openHelp('sites'))}>
            Where it works
          </a>{' '}
          on the help page.
        </p>
      </div>
    );
  }
  return (
    <div class="brm-panel-empty">
      <strong>Open your app in this tab</strong>
      <p>Its threads show here. Browser Review runs on web pages, not on browser pages like this one.</p>
    </div>
  );
}

const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
const root = document.getElementById('root');
void chrome.windows.getCurrent().then((w) => {
  if (root && w.id !== undefined) render(<PanelApp windowId={w.id} />, root);
});
