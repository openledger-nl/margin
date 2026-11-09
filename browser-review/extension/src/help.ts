// The help page (help.html): setup command, live connection status, shortcuts.
import { MCP_ADD_COMMAND, MCP_ADD_COMMAND_CODEX, MCP_JSON_CONFIG } from '@brm/shared';
import type { ContentRequest, StatusResponse } from './messages.ts';
import { HOLD_KEY, HOLD_KEYS, SEND_KEY, SEND_KEYS, toHoldKey, toSendKey } from './settings.ts';
import { SITE_ACCESS, SITE_ACCESS_KEY, SITES_KEY, toSiteAccess, toSites } from './sites.ts';

const $ = (id: string) => document.getElementById(id)!;

$('cmd').textContent = MCP_ADD_COMMAND;
$('cmd-codex').textContent = MCP_ADD_COMMAND_CODEX;
$('cmd-json').textContent = MCP_JSON_CONFIG;
$('version').textContent = chrome.runtime.getManifest().version;

// ---------- copy buttons ----------

for (const btn of document.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
  btn.addEventListener('click', () => {
    const text = $(btn.dataset.copy!).textContent ?? '';
    void navigator.clipboard.writeText(text).then(() => {
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = 'Copy'), 1500);
    });
  });
}

// ---------- live status ----------

async function refreshStatus(): Promise<void> {
  let s: StatusResponse | null = null;
  try {
    s = (await chrome.runtime.sendMessage({ type: 'status' } satisfies ContentRequest)) as StatusResponse;
  } catch {
    s = null;
  }
  const box = $('status');
  box.classList.toggle('is-on', !!s?.claude);
  if (s?.claude) {
    $('status-title').textContent = 'A coding agent is connected';
    $('status-text').textContent = `MCP server ${s.mcpVersion ?? ''} is running. Ask your agent to check the review comments.`;
  } else {
    $('status-title').textContent = 'No coding agent is connected';
    $('status-text').textContent =
      'Do step 1 once, then start a session in your agent. Your comments are saved in the meantime.';
  }
}
void refreshStatus();
setInterval(() => void refreshStatus(), 2000);

// ---------- shortcuts, as the user has them set ----------

const LABELS: Record<string, string> = {
  _execute_action: 'Show the sidebar (the extension icon)',
  'toggle-overlay': 'Show the overlay with the sidebar, or hide it',
  'pick-element': 'Pick an element',
  'page-comment': 'Comment on the whole page',
  'toggle-threads': 'Open or close the threads sidebar',
};

void chrome.commands.getAll().then((commands) => {
  const rows = $('shortcut-rows');
  for (const c of commands) {
    if (!c.name || c.name === '_execute_action') continue;
    const tr = document.createElement('tr');
    const action = document.createElement('td');
    action.textContent = LABELS[c.name] ?? c.description ?? c.name;
    const keys = document.createElement('td');
    if (c.shortcut) {
      c.shortcut.split('+').forEach((k, i) => {
        if (i > 0) keys.append('+');
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        keys.append(kbd);
      });
    } else {
      keys.textContent = 'not set';
      keys.style.color = 'var(--dim)';
    }
    tr.append(action, keys);
    rows.append(tr);
  }
});

// ---------- hold to pick ----------

const holdSelect = $('hold-key') as HTMLSelectElement;
for (const [code, label] of Object.entries(HOLD_KEYS)) holdSelect.add(new Option(label, code));
void chrome.storage.local.get(HOLD_KEY).then((r) => (holdSelect.value = toHoldKey(r[HOLD_KEY])));
holdSelect.addEventListener('change', () => void chrome.storage.local.set({ [HOLD_KEY]: holdSelect.value }));

// ---------- send key ----------

const sendSelect = $('send-key') as HTMLSelectElement;
for (const [key, label] of Object.entries(SEND_KEYS)) sendSelect.add(new Option(label, key));
void chrome.storage.local.get(SEND_KEY).then((r) => (sendSelect.value = toSendKey(r[SEND_KEY])));
sendSelect.addEventListener('change', () => void chrome.storage.local.set({ [SEND_KEY]: sendSelect.value }));

// ---------- where it works: strict mode and the sites turned on ----------

const accessSelect = $('site-access') as HTMLSelectElement;
for (const [key, label] of Object.entries(SITE_ACCESS)) accessSelect.add(new Option(label, key));
accessSelect.addEventListener('change', () => void chrome.storage.local.set({ [SITE_ACCESS_KEY]: accessSelect.value }));

async function showSites(): Promise<void> {
  const r = await chrome.storage.local.get([SITE_ACCESS_KEY, SITES_KEY]);
  accessSelect.value = toSiteAccess(r[SITE_ACCESS_KEY]);
  const sites = toSites(r[SITES_KEY]);
  const list = $('site-list');
  list.replaceChildren();
  $('no-sites').hidden = sites.length > 0;
  for (const origin of sites) {
    const li = document.createElement('li');
    const name = document.createElement('code');
    name.textContent = origin;
    const remove = document.createElement('button');
    remove.className = 'link-btn';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      void chrome.storage.local.set({ [SITES_KEY]: sites.filter((s) => s !== origin) });
    });
    li.append(name, remove);
    list.append(li);
  }
}
void showSites();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (SITE_ACCESS_KEY in changes || SITES_KEY in changes)) void showSites();
});

// ---------- browser differences ----------

const isFirefox = navigator.userAgent.includes('Firefox/');

/** Firefox 137+ can open its shortcut settings; Chromium has a page for it. */
type CommandsWithSettings = typeof chrome.commands & { openShortcutSettings?: () => Promise<void> };

$('edit-shortcuts').addEventListener('click', () => {
  const commands = chrome.commands as CommandsWithSettings;
  if (isFirefox) {
    if (commands.openShortcutSettings) void commands.openShortcutSettings();
    else $('shortcuts-where').textContent = 'In Firefox: about:addons, gear icon, Manage Extension Shortcuts.';
    return;
  }
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// Firefox lets users switch off the extension's site access. Without it there is no overlay and no screenshots.
const ACCESS: chrome.permissions.Permissions = { origins: ['<all_urls>'] };
async function checkAccess(): Promise<void> {
  const granted = await chrome.permissions.contains(ACCESS).catch(() => true);
  $('access').hidden = granted;
}
$('grant').addEventListener('click', () => {
  void chrome.permissions.request(ACCESS).then(() => checkAccess());
});
void checkAccess();
