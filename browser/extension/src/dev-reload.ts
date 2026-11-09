// Hot reload for development, only in `node build.ts --watch` builds: there
// __DEV_RELOAD__ is the URL of the build server, otherwise null, so the call in
// background.ts is dead code and esbuild leaves this module out.
//
// The background long-polls the build id. When a new build is out it reloads
// the extension (new background, content scripts, pages). Every fresh start of
// the extension (this reload, the reload icon on its card, a browser restart)
// reloads the tabs the overlay runs in, whose old content scripts are cut off by the
// reload. What was being typed in the overlay survives (drafts).

// storage.session is emptied by a reload of the extension and survives the service worker sleeping.
const BASELINE_KEY = 'devReloadBuild'; // build this extension was loaded at
const STARTED_KEY = 'devReloadStarted'; // the tabs were reloaded after this start

/** `url`: the build server's /build. `tabs`: the tabs the overlay runs in (to reload). */
export function startDevReload(url: string, tabs: () => Promise<chrome.tabs.Tab[]>): void {
  void (async () => {
    // A fresh start of the extension: the tabs still run the old content scripts.
    const stored = await chrome.storage.session.get([BASELINE_KEY, STARTED_KEY]);
    let baseline = stored[BASELINE_KEY] as string | undefined;
    if (!stored[STARTED_KEY]) {
      await chrome.storage.session.set({ [STARTED_KEY]: true });
      for (const tab of await tabs()) if (tab.id !== undefined) void chrome.tabs.reload(tab.id);
    }
    for (;;) {
      // An extension API call keeps the service worker awake while we wait.
      await chrome.runtime.getPlatformInfo();
      let id: string;
      try {
        const res = await fetch(`${url}?since=${encodeURIComponent(baseline ?? '')}`, { cache: 'no-store' });
        id = await res.text();
      } catch {
        await new Promise((r) => setTimeout(r, 2000)); // watch not running (yet)
        continue;
      }
      if (!baseline) {
        baseline = id;
        await chrome.storage.session.set({ [BASELINE_KEY]: id });
      } else if (id !== baseline) {
        console.log('Browser Review: new build, reloading');
        chrome.runtime.reload();
        return;
      }
    }
  })();
}
