// Background service worker. Owns all review data (IndexedDB) and connects to the
// MCP server that Claude Code starts (npx browser-review-mcp), which listens on
// ws://127.0.0.1:4777. Claude's tool calls arrive here as "call" messages.
import {
  DEFAULT_PORT,
  cropBox,
  pageKey,
  type BridgeCalls,
  type BridgeMethod,
  type Comment,
  type FromExtension,
  type Rect,
  type ToExtension,
  type Viewport,
} from '@brm/shared';
import {
  PANEL_FOCUS_KEY,
  type CaptureResponse,
  type ContentRequest,
  type OverlayCommand,
  type PanelRequest,
  type PanelResponse,
  type PanelState,
  type PortEvent,
  type PrepareCaptureResponse,
  type ScreenshotDataResponse,
  type StatusResponse,
  type StoreOps,
  type StoreResponse,
  type TabRequest,
} from './messages.ts';
import { startDevReload } from './dev-reload.ts';
import {
  SITE_ACCESS_KEY,
  SITES_KEY,
  canTurnOn,
  isAllowed,
  isWebUrl,
  matchPatterns,
  originOf,
  toSiteAccess,
  toSites,
  type SiteSettings,
} from './sites.ts';
import { IdbDb } from './idb.ts';
import { Store, mergeVisit, type PageVisit, type PullSummary, type SendDecision } from '@brm/shared';
import { cropToPng } from './crop.ts';
import {
  PROJECTS_KEY,
  VISITS_KEY,
  projectVisitsKey,
  checkProject,
  hubErrorMessage,
  pullProject,
  pushToHub,
  sendDecision,
  summary,
  toProjects,
  type HubAction,
  type Project,
} from './sync.ts';

const WS_URL = `ws://127.0.0.1:${DEFAULT_PORT}/ws`;
const VERSION = chrome.runtime.getManifest().version;

const store = new Store(new IdbDb());

// ---------- connection to Claude Code (the MCP server) ----------

let ws: WebSocket | null = null;
let connected = false;
let mcpVersion: string | null = null;
let retryMs = 1000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const ports = new Set<chrome.runtime.Port>();

function setConnected(value: boolean): void {
  if (connected === value) return;
  connected = value;
  if (!value) mcpVersion = null;
  broadcast({ type: 'status', connected });
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const socket = new WebSocket(WS_URL);
  ws = socket;
  socket.onopen = () => {
    retryMs = 1000;
    send({ type: 'hello', version: VERSION });
    setConnected(true);
  };
  socket.onmessage = (ev) => {
    let msg: ToExtension;
    try {
      msg = JSON.parse(String(ev.data)) as ToExtension;
    } catch {
      return;
    }
    void onBridgeMessage(msg);
  };
  socket.onclose = () => {
    if (ws === socket) ws = null;
    setConnected(false);
    // Claude Code starts the MCP server with the session, so it comes and goes. Keep trying.
    retryTimer = setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 5_000);
  };
  socket.onerror = () => socket.close();
}

function send(msg: FromExtension): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

async function onBridgeMessage(msg: ToExtension): Promise<void> {
  switch (msg.type) {
    case 'ping':
      send({ type: 'pong' });
      break;
    case 'hello':
      mcpVersion = msg.version;
      break;
    case 'call':
      try {
        const data = await handleCall(msg.method, msg.params);
        send({ type: 'result', id: msg.id, ok: true, data });
      } catch (err) {
        send({ type: 'result', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      break;
  }
}

/** One tool call from Claude. */
async function handleCall(method: BridgeMethod, params: unknown): Promise<unknown> {
  const call = <M extends BridgeMethod>(_m: M) => params as BridgeCalls[M]['params'];
  switch (method) {
    case 'list': {
      const p = call('list');
      let project: string | null | undefined;
      if (typeof p.project === 'string') project = (await projectByName(p.project)).id;
      else if (p.project === null) project = null;
      return store.list({ origin: p.origin, statuses: p.statuses, project });
    }
    case 'projects':
      return (await readProjects()).map(summary);
    case 'pull': {
      const name = call('pull').project;
      return pullProjects(name === undefined ? undefined : (await projectByName(name)).id);
    }
    case 'get':
      return store.mustGet(call('get').id);
    case 'screenshot': {
      const p = call('screenshot');
      const meta = await store.latestScreenshot(p.id, p.kind, p.which === 'initial' ? 'initial' : undefined);
      const dataUrl = meta ? await store.readScreenshot(meta.id) : null;
      return meta && dataUrl ? ({ meta, dataUrl } satisfies BridgeCalls['screenshot']['result']) : null;
    }
    case 'capture': {
      const c = await store.mustGet(call('capture').id);
      const shot = await captureForComment(c);
      await store.addScreenshot(c.id, 'page', 'capture', shot.page);
      if (shot.element) await store.addScreenshot(c.id, 'element', 'capture', shot.element);
      return { comment: c, ...shot } satisfies BridgeCalls['capture']['result'];
    }
    // On customer feedback the agent's updates wait in the outbox until the developer sends them.
    case 'start_work': {
      const { id } = call('start_work');
      return changed((await queued(id, { type: 'start_work' })) ?? (await store.startWork(id)));
    }
    case 'reply': {
      const p = call('reply');
      return changed((await queued(p.id, { type: 'reply', message: p.message })) ?? (await store.addMessage(p.id, 'claude', p.message)));
    }
    case 'submit_solution': {
      const p = call('submit_solution');
      const action: HubAction = { type: 'submit_solution', note: p.note, files: p.files };
      return changed((await queued(p.id, action)) ?? (await store.submitSolution(p.id, p.note, p.files)));
    }
  }
  // A newer MCP server than this extension knows.
  throw new Error(`This version of the Margin extension (${VERSION}) does not know "${String(method)}". Update the extension.`);
}

// ---------- review-hub projects (sync.ts) ----------

let projectsQueue: Promise<unknown> = Promise.resolve();

async function readProjects(): Promise<Project[]> {
  return toProjects((await chrome.storage.local.get(PROJECTS_KEY))[PROJECTS_KEY]);
}

/** Read, change and store the projects, one change at a time. */
function updateProjects<T>(fn: (list: Project[]) => { list: Project[]; result: T }): Promise<T> {
  const run = projectsQueue.then(async () => {
    const { list, result } = fn(await readProjects());
    await chrome.storage.local.set({ [PROJECTS_KEY]: list });
    return result;
  });
  projectsQueue = run.catch(() => {});
  return run.finally(() => broadcast({ type: 'projects-changed' }));
}

async function projectByName(name: string): Promise<Project> {
  const list = await readProjects();
  const p = list.find((x) => x.name === name) ?? list.find((x) => x.id === name);
  if (!p) {
    const known = list.map((x) => `"${x.name}"`).join(', ');
    throw new Error(`No project "${name}" in the Margin extension. ${known ? `Known: ${known}.` : 'Add one on the help page (Projects).'}`);
  }
  return p;
}

/** Pulls in flight, per project, so two pulls of one project never overlap. */
const pulling = new Map<string, Promise<PullSummary>>();

/** Pulls one project or all. A failed project gets its error; the others still pull. */
async function pullProjects(id?: string): Promise<PullSummary[]> {
  const list = (await readProjects()).filter((p) => id === undefined || p.id === id);
  return Promise.all(list.map((p) => pullOne(p)));
}

function pullOne(p: Project): Promise<PullSummary> {
  const running = pulling.get(p.id);
  if (running) return running;
  const run = (async (): Promise<PullSummary> => {
    try {
      const { summary: s, now, origins, visits } = await pullProject(store, p);
      if (visits) await chrome.storage.local.set({ [projectVisitsKey(p.id)]: visits });
      await updateProjects((list) => ({ list: list.map((x) => (x.id === p.id ? { ...x, lastPull: now, lastError: null } : x)), result: null }));
      for (const origin of origins) changed({ origin });
      return s;
    } catch (err) {
      const error = hubErrorMessage(p, err);
      await updateProjects((list) => ({ list: list.map((x) => (x.id === p.id ? { ...x, lastError: error } : x)), result: null }));
      return { project: p.name, added: 0, updated: 0, removed: 0, error };
    }
  })().finally(() => pulling.delete(p.id));
  pulling.set(p.id, run);
  return run;
}

/** For a copy of a hub comment: queues the agent's update for the developer to send. Null for a local comment. */
async function queued(id: number, action: HubAction): Promise<Comment | null> {
  const c = await store.mustGet(id);
  if (!c.project) return null;
  return store.queueOutbox(id, action);
}

/** For a copy of a hub comment: does the action on the hub. Null for a local comment (do it here). */
async function viaHub(id: number, action: HubAction): Promise<Comment | null> {
  const c = await store.mustGet(id);
  if (!c.project) return null;
  const p = (await readProjects()).find((x) => x.id === c.project);
  if (!p) throw new Error(`Comment #${id} came from a review-hub project that was removed.`);
  return pushToHub(store, p, c, action);
}

/** Sends the developer's decisions one by one; a failed one keeps its outbox and says why. */
async function sendAll(decisions: SendDecision[]): Promise<{ id: number; ok: boolean; error: string | null }[]> {
  const projects = await readProjects();
  const results: { id: number; ok: boolean; error: string | null }[] = [];
  for (const d of decisions) {
    try {
      const c = await store.mustGet(d.id);
      const p = projects.find((x) => x.id === c.project);
      if (!p) throw new Error(`Comment #${d.id} is not customer feedback of a project you have.`);
      changed(await sendDecision(store, p, c, d));
      results.push({ id: d.id, ok: true, error: null });
    } catch (err) {
      results.push({ id: d.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/** Customers accept, reopen and delete on the staging site; the hub decides. */
async function refuseOnCopy(id: number, what: string): Promise<void> {
  const c = await store.mustGet(id);
  if (c.project) {
    const p = (await readProjects()).find((x) => x.id === c.project);
    throw new Error(`Comment #${id} is customer feedback from ${p?.name ?? 'a review hub'}: only the customer can ${what} it, on the staging site.`);
  }
}

/** Tells every overlay on that site to reload its comments. */
function changed<T extends Comment | { origin: string }>(c: T): T {
  broadcast({ type: 'comments-changed', origin: c.origin });
  return c;
}

function broadcast(ev: PortEvent): void {
  for (const p of ports) {
    try {
      p.postMessage(ev);
    } catch {
      ports.delete(p);
    }
  }
}

// The service worker can be stopped by the browser. Alarms wake it up so it reconnects.
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
/** New customer feedback every few minutes, without anyone pressing Pull. */
const PULL_ALARM = 'pull-projects';
chrome.alarms.create(PULL_ALARM, { periodInMinutes: 5 });
// Only in `pnpm dev` builds (see dev-reload.ts).
if (__DEV_RELOAD__) startDevReload(__DEV_RELOAD__, () => overlayTabs());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PULL_ALARM) void pullProjects();
  else connect();
});
chrome.runtime.onStartup.addListener(() => connect());
chrome.runtime.onInstalled.addListener((details) => {
  connect();
  if (details.reason === 'install') openHelp();
});
connect();

// ---------- page visits, for the overview's site map ----------

let visitsQueue: Promise<unknown> = Promise.resolve();

/** Only pages where the overlay runs; path and title only (pageKey drops the query). */
function recordVisit(url: string, title: string): Promise<void> {
  const run = visitsQueue.then(async () => {
    await siteSettingsReady;
    if (!isAllowed(url, siteSettings)) return;
    const { origin, path } = pageKey(url);
    const list = ((await chrome.storage.local.get(VISITS_KEY))[VISITS_KEY] as PageVisit[] | undefined) ?? [];
    const next = mergeVisit(list, { origin, path, title: title.slice(0, 300), by: 'You', at: new Date().toISOString() });
    await chrome.storage.local.set({ [VISITS_KEY]: next });
  });
  visitsQueue = run.catch(() => {});
  return run;
}

// ---------- help page ----------

function openHelp(section?: string): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`help.html${section ? `#${section}` : ''}`) });
}

// ---------- requests from the overlay and extension pages ----------

chrome.runtime.onConnect.addListener((port) => {
  const panelWindow = port.name.startsWith(PANEL_PORT) ? Number(port.name.slice(PANEL_PORT.length)) : null;
  if (port.name !== 'brm' && panelWindow === null) return;
  ports.add(port);
  port.postMessage({ type: 'status', connected } satisfies PortEvent);
  port.onDisconnect.addListener(() => ports.delete(port));
  if (panelWindow !== null) {
    panelPorts.set(panelWindow, port);
    void notifyPanelState(panelWindow);
    port.onDisconnect.addListener(() => {
      if (panelPorts.get(panelWindow) === port) panelPorts.delete(panelWindow);
      void notifyPanelState(panelWindow);
    });
  }
  connect();
});

chrome.runtime.onMessage.addListener((req: ContentRequest, sender, sendResponse) => {
  if (req.type === 'store') {
    void runStoreOp(req.op, req.args)
      .then((data): StoreResponse => ({ ok: true, data }))
      .catch((err: unknown): StoreResponse => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))
      .then(sendResponse);
    return true;
  }
  if (req.type === 'capture') {
    const windowId = sender.tab?.windowId;
    if (windowId === undefined) {
      sendResponse({ ok: false, error: 'No tab.' } satisfies CaptureResponse);
      return false;
    }
    void capture(windowId, req.rect, req.viewport)
      .then((r): CaptureResponse => ({ ok: true, ...r }))
      .catch((err: unknown): CaptureResponse => ({ ok: false, error: String(err) }))
      .then(sendResponse);
    return true;
  }
  if (req.type === 'screenshot-data') {
    void store
      .readScreenshot(req.id)
      .then((dataUrl): ScreenshotDataResponse => (dataUrl ? { ok: true, dataUrl } : { ok: false, error: 'Not found.' }))
      .then(sendResponse);
    return true;
  }
  if (req.type === 'open-help') {
    openHelp(req.section);
    return false;
  }
  if (req.type === 'visit') {
    void recordVisit(req.url, req.title);
    return false;
  }
  if (req.type === 'open-overview') {
    const q = req.project ? `project=${encodeURIComponent(req.project)}` : req.origin ? `origin=${encodeURIComponent(req.origin)}` : '';
    void chrome.tabs.create({ url: chrome.runtime.getURL(`overview.html${q ? `?${q}` : ''}`) });
    return false;
  }
  if (req.type === 'status') {
    connect();
    sendResponse({ claude: connected, mcpVersion, version: VERSION } satisfies StatusResponse);
    return false;
  }
  const windowId = sender.tab?.windowId;
  if (req.type === 'panel-state') {
    sendResponse({ supported: PANEL_SUPPORTED, open: windowId !== undefined && panelPorts.has(windowId) } satisfies PanelState);
    return false;
  }
  if (req.type === 'open-panel') {
    if (!PANEL_SUPPORTED || windowId === undefined) {
      sendResponse({ ok: false } satisfies PanelResponse);
      return false;
    }
    // Open first: the browser only allows it while the click's user gesture lasts.
    const opening = panelPorts.has(windowId) ? Promise.resolve(true) : openPanel(windowId);
    if (req.focus !== undefined) focusThread(req.focus);
    void opening.then((ok) => sendResponse({ ok } satisfies PanelResponse));
    return true;
  }
  if (req.type === 'close-panel') {
    if (windowId !== undefined) closePanel(windowId);
    return false;
  }
  if (req.type === 'focus-thread') {
    focusThread(req.id);
    return false;
  }
  if (req.type === 'turn-on') {
    void chrome.tabs
      .get(req.tabId)
      .then((tab) => sendToTab(tab, { type: 'show', visible: true }))
      .catch(() => {});
    return false;
  }
  return false;
});

// ---------- the threads side panel (Chrome sidePanel, Firefox sidebar) ----------

/** Firefox's sidebar API (browser.sidebarAction; `chrome` is mapped to `browser` there). */
interface SidebarAction {
  open(): Promise<void>;
  close(): Promise<void>;
}
const sidebarAction = (chrome as unknown as { sidebarAction?: SidebarAction }).sidebarAction;
const PANEL_SUPPORTED = Boolean(sidebarAction ?? chrome.sidePanel?.open);
/** The panel page connects with this port name plus its window id. */
const PANEL_PORT = 'brm-panel:';
/** Open panels, by window. */
const panelPorts = new Map<number, chrome.runtime.Port>();

/** Must be called right away in a user action handler (click on the icon, a shortcut). */
function openPanel(windowId: number): Promise<boolean> {
  try {
    const p = sidebarAction ? sidebarAction.open() : chrome.sidePanel.open({ windowId });
    return p.then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

function closePanel(windowId: number): void {
  // Firefox only closes it from a user action handler; the panel page then tries itself.
  if (sidebarAction) void sidebarAction.close().catch(() => {});
  void chrome.runtime.sendMessage({ type: 'panel-close', windowId } satisfies PanelRequest).catch(() => {});
}

/** Open or close; returns whether it is open afterwards. */
function togglePanel(windowId: number): boolean {
  if (panelPorts.has(windowId)) {
    closePanel(windowId);
    return false;
  }
  void openPanel(windowId);
  return true;
}

function focusThread(id: number): void {
  void chrome.storage.session.set({ [PANEL_FOCUS_KEY]: { id, at: Date.now() } });
}

/** Tells the overlays in the window whether the panel is open (the Threads button shows it). */
async function notifyPanelState(windowId: number): Promise<void> {
  const open = panelPorts.has(windowId);
  for (const tab of await overlayTabs({ windowId })) {
    if (tab.id !== undefined) {
      void chrome.tabs.sendMessage(tab.id, { type: 'panel-state', open } satisfies TabRequest).catch(() => {});
    }
  }
}

async function runStoreOp(op: keyof StoreOps, args: unknown): Promise<unknown> {
  const a = <K extends keyof StoreOps>(_k: K) => args as StoreOps[K]['args'];
  switch (op) {
    case 'list':
      return store.list({ origin: a('list').origin });
    case 'create': {
      const input = a('create');
      await siteSettingsReady;
      if (!isAllowed(input.url, siteSettings)) throw new Error('Margin Browser Review is not on for this site.');
      return changed(await store.create(input));
    }
    case 'reply': {
      const p = a('reply');
      // On customer feedback the developer's reply goes to the hub, with their token's name.
      return changed((await viaHub(p.id, { type: 'reply', message: p.body })) ?? (await store.addMessage(p.id, 'user', p.body)));
    }
    case 'accept':
      await refuseOnCopy(a('accept').id, 'accept');
      return changed(await store.accept(a('accept').id));
    case 'reopen': {
      const p = a('reopen');
      await refuseOnCopy(p.id, 'reopen');
      return changed(await store.reopen(p.id, p.body));
    }
    case 'delete': {
      await refuseOnCopy(a('delete').id, 'delete');
      const c = await store.mustGet(a('delete').id);
      await store.delete(c.id);
      changed(c);
      return null;
    }
    case 'projects':
      return (await readProjects()).map(summary);
    case 'addProject': {
      const { hubUrl, token } = a('addProject');
      const p = await checkProject(hubUrl, token);
      await updateProjects((list) => {
        if (list.some((x) => x.hubUrl === p.hubUrl)) throw new Error(`${p.name} (${p.hubUrl}) is already added. Remove it first to use another token.`);
        return { list: [...list, p], result: null };
      });
      void pullOne(p);
      return summary(p);
    }
    case 'removeProject': {
      const { id } = a('removeProject');
      const gone = (await readProjects()).find((x) => x.id === id);
      await updateProjects((list) => ({ list: list.filter((x) => x.id !== id), result: null }));
      await store.deleteProject(id);
      await chrome.storage.local.remove(projectVisitsKey(id));
      if (gone) changed({ origin: gone.origin });
      return null;
    }
    case 'pull':
      return pullProjects(a('pull').id);
    case 'send':
      return sendAll(a('send').decisions);
    case 'visits': {
      const { origin, project } = a('visits');
      if (project) return ((await chrome.storage.local.get(projectVisitsKey(project)))[projectVisitsKey(project)] as PageVisit[] | undefined) ?? [];
      const all = ((await chrome.storage.local.get(VISITS_KEY))[VISITS_KEY] as PageVisit[] | undefined) ?? [];
      return origin ? all.filter((v) => v.origin === origin) : all;
    }
    case 'discard': {
      const c = await store.discardOutbox(a('discard').id);
      return changed(c);
    }
  }
}

// ---------- screenshots ----------

let lastCapture = 0;

/** Visible-tab screenshot plus an optional crop around rect (CSS pixels). */
async function capture(windowId: number, rect: Rect | null, viewport: Viewport): Promise<{ page: string; element: string | null }> {
  // captureVisibleTab is limited to 2 calls per second.
  const wait = lastCapture + 600 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCapture = Date.now();
  const page = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  if (!rect || rect.width <= 0 || rect.height <= 0) return { page, element: null };

  const bitmap = await createImageBitmap(await (await fetch(page)).blob());
  const box = cropBox(rect, bitmap, bitmap.width / viewport.width);
  return { page, element: box ? await cropToPng(bitmap, box) : null };
}

/** Live screenshot asked for by Claude over MCP. */
async function captureForComment(c: Comment): Promise<{ page: string; element: string | null; note: string | null }> {
  const tabs = await overlayTabs();
  const matching = tabs.filter((t) => {
    if (!t.url || t.id === undefined) return false;
    const k = pageKey(t.url);
    return k.origin === c.origin && k.path === c.path;
  });
  const tab = matching.find((t) => t.active) ?? matching[0];
  if (!tab?.id || tab.windowId === undefined) {
    throw new Error(`No open tab on ${c.origin}${c.path}. Ask the user to open that page in Brave.`);
  }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  await new Promise((r) => setTimeout(r, 300));

  let prep: PrepareCaptureResponse | null = null;
  try {
    prep = (await chrome.tabs.sendMessage(tab.id, { type: 'prepare-capture', comment: c } satisfies TabRequest)) as PrepareCaptureResponse;
  } catch {
    prep = null;
  }
  try {
    const viewport = prep?.viewport ?? { width: tab.width ?? 1, height: tab.height ?? 1, dpr: 1 };
    const shot = await capture(tab.windowId, prep?.rect ?? null, viewport);
    const note = prep ? prep.note : 'The overlay is not loaded in that tab (reload the page), so the element could not be located.';
    return { ...shot, note };
  } finally {
    if (prep) void chrome.tabs.sendMessage(tab.id, { type: 'capture-done' } satisfies TabRequest).catch(() => {});
  }
}

// ---------- which sites the overlay runs on (see sites.ts) ----------

let siteSettings: SiteSettings = { access: 'any', sites: [] };
const siteSettingsReady = loadSiteSettings();

async function loadSiteSettings(): Promise<void> {
  const r = await chrome.storage.local.get([SITE_ACCESS_KEY, SITES_KEY]);
  siteSettings = { access: toSiteAccess(r[SITE_ACCESS_KEY]), sites: toSites(r[SITES_KEY]) };
  await syncContentScripts();
}

// Changed on the help page (strict mode, a site removed) or by turnOn().
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (SITE_ACCESS_KEY in changes || SITES_KEY in changes)) {
    void loadSiteSettings().then(syncAllPopups);
  }
});

/** Tabs whose page the overlay runs on. */
async function overlayTabs(query: chrome.tabs.QueryInfo = {}): Promise<chrome.tabs.Tab[]> {
  await siteSettingsReady;
  return (await chrome.tabs.query(query)).filter((t) => t.url && isAllowed(t.url, siteSettings));
}

/**
 * The content scripts are registered from code, not in the manifest, so the
 * sites can change. Registered once; again only when the sites change.
 */
const SCRIPTS: chrome.scripting.RegisteredContentScript[] = [
  { id: 'brm-main-world', js: ['main-world.js'], world: 'MAIN', runAt: 'document_start' },
  { id: 'brm-overlay', js: ['content.js'], runAt: 'document_idle' },
];
let scriptSync: Promise<void> = Promise.resolve();

function syncContentScripts(): Promise<void> {
  scriptSync = scriptSync
    .then(async () => {
      const matches = matchPatterns(siteSettings);
      const key = (m: string[] | undefined) => JSON.stringify([...(m ?? [])].sort());
      const current = await chrome.scripting.getRegisteredContentScripts({ ids: SCRIPTS.map((s) => s.id) });
      if (current.length === SCRIPTS.length && current.every((c) => key(c.matches) === key(matches))) return;
      if (current.length) await chrome.scripting.unregisterContentScripts({ ids: current.map((c) => c.id) });
      try {
        await chrome.scripting.registerContentScripts(SCRIPTS.map((s) => ({ ...s, matches })));
      } catch (err) {
        // One pattern the browser rejects fails them all: keep at least local addresses and the sites turned on.
        console.error('Margin Browser Review: some sites could not be registered', err);
        const safe = matchPatterns({ access: 'local', sites: [] }).concat(
          matchPatterns({ access: 'any', sites: siteSettings.sites }).filter((m) => !m.startsWith('*://*.')),
        );
        await chrome.scripting.registerContentScripts(SCRIPTS.map((s) => ({ ...s, matches: [...new Set(safe)] })));
      }
    })
    .catch((err: unknown) => console.error('Margin Browser Review: registering the content scripts failed', err));
  return scriptSync;
}

/**
 * The extension icon (or a shortcut) on a site that is not on yet: remember the
 * site, and load the overlay into this tab right away.
 */
async function turnOn(tab: chrome.tabs.Tab): Promise<boolean> {
  const origin = tab.url ? originOf(tab.url) : null;
  if (!origin || tab.id === undefined) return false;
  siteSettings = { ...siteSettings, sites: [...new Set([...siteSettings.sites, origin])] };
  await chrome.storage.local.set({ [SITES_KEY]: siteSettings.sites });
  await syncContentScripts();
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['main-world.js'], world: 'MAIN' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch {
    return false; // a page the browser protects (the web store, for example)
  }
  syncPopup(tab.id, tab.url);
  return true;
}

// ---------- toggle, shortcuts, and the notice where it can't run ----------

const NOTICE = 'notice.html';
type NoticeReason = 'strict' | 'not-web' | 'not-loaded';

/**
 * Where the overlay can't run, the action opens a popup that explains why. Elsewhere
 * the popup is off, so a click reaches onClicked: it toggles the overlay, or turns
 * the site on first.
 */
function syncPopup(tabId: number, url: string | undefined): void {
  let popup = '';
  if (!url || !(isAllowed(url, siteSettings) || canTurnOn(url, siteSettings))) {
    popup = `${NOTICE}?reason=${url && isWebUrl(url) ? 'strict' : 'not-web'}`;
  }
  void chrome.action.setPopup({ tabId, popup }).catch(() => {});
}

function syncAllPopups(): void {
  void chrome.tabs.query({}).then((tabs) => {
    for (const t of tabs) if (t.id !== undefined) syncPopup(t.id, t.url);
  });
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url !== undefined || info.status === 'loading') syncPopup(tabId, tab.url);
});
void siteSettingsReady.then(syncAllPopups);

/** Opens the notice popup from code (shortcuts, or a tab without the overlay). */
async function showNotice(tab: chrome.tabs.Tab, reason: NoticeReason): Promise<void> {
  if (tab.id === undefined) return;
  await chrome.action.setPopup({ tabId: tab.id, popup: `${NOTICE}?reason=${reason}` });
  try {
    await chrome.action.openPopup({ windowId: tab.windowId });
  } catch {
    // openPopup can fail (no focused window, older browser). The next click shows it.
    return;
  }
  syncPopup(tab.id, tab.url);
}

async function sendToTab(tab: chrome.tabs.Tab | undefined, req: TabRequest): Promise<void> {
  if (tab?.id === undefined) return;
  await siteSettingsReady;
  const url = tab.url ?? '';
  let justTurnedOn = false;
  if (!isAllowed(url, siteSettings)) {
    if (!canTurnOn(url, siteSettings)) return showNotice(tab, isWebUrl(url) ? 'strict' : 'not-web');
    if (!(await turnOn(tab))) return showNotice(tab, 'not-web');
    justTurnedOn = true;
  }
  // A freshly loaded overlay needs a moment before it listens.
  for (let attempt = 0; ; attempt++) {
    try {
      await chrome.tabs.sendMessage(tab.id, req);
      return;
    } catch (err) {
      // Nothing listens: the tab was open before the extension was (re)loaded.
      // (Other errors, like no reply to a fire-and-forget message, are fine.)
      if (!/Receiving end does not exist|Could not establish connection/i.test(String(err))) return;
      if (!justTurnedOn || attempt >= 10) return showNotice(tab, 'not-loaded');
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

const OVERLAY_COMMANDS: readonly string[] = ['pick-element', 'page-comment', 'toggle-threads'] satisfies OverlayCommand[];

/**
 * Extension icon / Alt+Shift+R: open the threads panel with the overlay, or
 * close both. Without a side panel API the overlay shows its own sidebar.
 */
function toggleAll(tab: chrome.tabs.Tab | undefined): void {
  if (!PANEL_SUPPORTED || tab?.windowId === undefined) {
    void sendToTab(tab, { type: 'toggle' });
    return;
  }
  const visible = togglePanel(tab.windowId);
  void sendToTab(tab, { type: 'show', visible });
}

chrome.action.onClicked.addListener((tab) => toggleAll(tab));
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-overlay') toggleAll(tab);
  else if (command === 'toggle-threads' && PANEL_SUPPORTED && tab?.windowId !== undefined) {
    const url = tab.url ?? '';
    if (!panelPorts.has(tab.windowId) && !isAllowed(url, siteSettings) && !canTurnOn(url, siteSettings)) {
      void showNotice(tab, isWebUrl(url) ? 'strict' : 'not-web');
    } else togglePanel(tab.windowId);
  } else if (OVERLAY_COMMANDS.includes(command)) {
    void sendToTab(tab, { type: 'command', command: command as OverlayCommand });
  }
});
