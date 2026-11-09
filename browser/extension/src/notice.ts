// The action popup shown where the overlay cannot run (see showNotice in background.ts).
import { SITE_ACCESS_KEY, SITES_KEY, isAllowed, toSiteAccess, toSites } from './sites.ts';

const params = new URLSearchParams(location.search);
const reason = params.get('reason');
const $ = (id: string) => document.getElementById(id)!;

$('help').addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('help.html') });
  window.close();
});

async function main(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (reason === 'not-loaded') {
    $('not-loaded').hidden = false;
    $('reload').addEventListener('click', () => {
      if (tab?.id !== undefined) void chrome.tabs.reload(tab.id);
      window.close();
    });
    return;
  }

  $('not-here').hidden = false;
  if (reason === 'strict') {
    $('not-here-title').textContent = 'Strict mode is on';
    $('not-here-text').textContent =
      'Browser Review only runs on localhost, 127.0.0.1 and [::1]. To use it on other sites, change "Where it works" on the help page.';
  } else {
    $('not-here-title').textContent = "Can't run on this page";
    $('not-here-text').textContent =
      'Browser Review runs on web pages (http and https), like your dev app. Browser pages and files are out of reach.';
  }
  $('here').textContent = tab?.url ? shortUrl(tab.url) : 'not a web page';

  const r = await chrome.storage.local.get([SITE_ACCESS_KEY, SITES_KEY]);
  const settings = { access: toSiteAccess(r[SITE_ACCESS_KEY]), sites: toSites(r[SITES_KEY]) };
  const local = (await chrome.tabs.query({})).filter((t) => t.url && isAllowed(t.url, settings));
  if (local.length === 0) {
    $('no-tabs').hidden = false;
    return;
  }
  $('tabs').hidden = false;
  const list = $('tab-list');
  for (const t of local) {
    const btn = document.createElement('button');
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = t.title || shortUrl(t.url!);
    const url = document.createElement('span');
    url.className = 'url';
    url.textContent = shortUrl(t.url!);
    btn.append(title, url);
    btn.addEventListener('click', () => {
      if (t.id !== undefined) void chrome.tabs.update(t.id, { active: true });
      void chrome.windows.update(t.windowId, { focused: true });
      window.close();
    });
    const li = document.createElement('li');
    li.append(btn);
    list.append(li);
  }
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:' ? `${url.protocol}//${url.host}${url.pathname}` : u;
  } catch {
    return u;
  }
}

void main();
