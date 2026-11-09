// The Host in the extension: the background worker owns the data, settings are
// in chrome.storage.local, requests arrive as runtime messages.
import type { Rect, ScreenshotUpload } from '@brm/shared';
import type {
  CaptureResponse,
  ContentRequest,
  PanelResponse,
  PanelState,
  PortEvent,
  ScreenshotDataResponse,
  StoreOp,
  StoreOps,
  StoreResponse,
  TabRequest,
} from '../messages.ts';
import type { Host } from './host.ts';

/**
 * After the extension is reloaded or updated, this script is cut off from it and
 * chrome.* calls throw right away ("Extension context invalidated").
 */
function alive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function sendMessage<T>(req: ContentRequest): Promise<T> {
  // Never throw synchronously: callers handle a rejected promise.
  try {
    return chrome.runtime.sendMessage(req) as Promise<T>;
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

async function op<K extends StoreOp>(name: K, args: StoreOps[K]['args']): Promise<StoreOps[K]['result']> {
  let res: StoreResponse<StoreOps[K]['result']>;
  try {
    res = await sendMessage({ type: 'store', op: name, args });
  } catch {
    throw new Error('The extension was reloaded. Reload this page.');
  }
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

async function capture(rect: Rect | null): Promise<ScreenshotUpload | undefined> {
  try {
    const res = await sendMessage<CaptureResponse>({
      type: 'capture',
      rect,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    });
    if (!res.ok) return undefined;
    return res.element ? { page: res.page, element: res.element } : { page: res.page };
  } catch {
    return undefined;
  }
}

/** portName: "brm" for the overlay, "brm-panel:<windowId>" for the side panel. */
export function createExtensionHost(opts: { portName?: string } = {}): Host {
  const portName = opts.portName ?? 'brm';
  return {
    comments: {
      list: (origin) => op('list', { origin }),
      create: (input) => op('create', input),
      reply: (id, body) => op('reply', { id, body }),
      accept: (id) => op('accept', { id }),
      reopen: (id, body) => op('reopen', { id, body }),
      remove: async (id) => {
        await op('delete', { id });
      },
      async screenshot(shotId) {
        try {
          const res = await sendMessage<ScreenshotDataResponse>({ type: 'screenshot-data', id: shotId });
          return res.ok ? res.dataUrl : null;
        } catch {
          return null;
        }
      },
    },

    settings: {
      async get(key) {
        return (await chrome.storage.local.get(key))[key];
      },
      set(key, value) {
        try {
          void chrome.storage.local.set({ [key]: value }).catch(() => {});
        } catch {
          // extension reloaded: nothing to store it in
        }
      },
      watch(key, onChange) {
        const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
          if (area === 'local' && key in changes) onChange(changes[key]?.newValue);
        };
        chrome.storage.onChanged.addListener(listener);
        return () => chrome.storage.onChanged.removeListener(listener);
      },
    },

    panel: {
      state: () => sendMessage<PanelState>({ type: 'panel-state' }).catch(() => null),
      open: (focus) =>
        sendMessage<PanelResponse>({ type: 'open-panel', focus })
          .then((r) => r.ok)
          .catch(() => false),
      close: () => void sendMessage({ type: 'close-panel' }).catch(() => {}),
      focus: (id) => void sendMessage({ type: 'focus-thread', id }).catch(() => {}),
    },

    capture,

    /** Reconnects when the service worker restarts. */
    subscribe(onEvent) {
      let port: chrome.runtime.Port | null = null;
      let stopped = false;
      const open = () => {
        if (stopped) return;
        try {
          port = chrome.runtime.connect({ name: portName });
        } catch {
          onEvent({ type: 'status', connected: false });
          return; // extension context is gone (extension reloaded)
        }
        port.onMessage.addListener((ev: PortEvent) => onEvent(ev));
        port.onDisconnect.addListener(() => {
          port = null;
          setTimeout(open, 1000);
        });
      };
      open();
      return () => {
        stopped = true;
        port?.disconnect();
      };
    },

    onRequest(handler) {
      // Chrome's rule: return true to answer later through sendResponse.
      const listener = (req: TabRequest, _sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => {
        const answer = handler(req);
        if (answer instanceof Promise) {
          void answer.then(sendResponse);
          return true;
        }
        if (answer !== undefined) sendResponse(answer);
        return false;
      };
      chrome.runtime.onMessage.addListener(listener);
      return () => chrome.runtime.onMessage.removeListener(listener);
    },

    openHelp: (section) => void sendMessage({ type: 'open-help', section }).catch(() => {}),

    alive,
  };
}
