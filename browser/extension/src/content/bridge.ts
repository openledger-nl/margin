// Content script side of the messaging with the background worker, which owns the data.
import type { CreateCommentInput, Rect, ScreenshotUpload } from '@brm/shared';
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
} from '../messages.ts';

export class ApiError extends Error {}

/**
 * After the extension is reloaded or updated, this script is cut off from it and
 * chrome.* calls throw right away ("Extension context invalidated").
 */
export function extensionAlive(): boolean {
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
    throw new ApiError('The extension was reloaded. Reload this page.');
  }
  if (!res.ok) throw new ApiError(res.error);
  return res.data;
}

export const bridge = {
  listComments: (origin: string) => op('list', { origin }),
  createComment: (input: CreateCommentInput) => op('create', input),
  reply: (id: number, body: string) => op('reply', { id, body }),
  accept: (id: number) => op('accept', { id }),
  reopen: (id: number, body?: string) => op('reopen', { id, body }),
  remove: async (id: number) => {
    await op('delete', { id });
  },
  openHelp: (section?: string) => void sendMessage({ type: 'open-help', section }).catch(() => {}),

  /** Threads side panel. null: the extension was reloaded. */
  panelState: () => sendMessage<PanelState>({ type: 'panel-state' }).catch(() => null),
  /** false: the browser did not open it (it only does for some clicks). */
  openPanel: (focus?: number) =>
    sendMessage<PanelResponse>({ type: 'open-panel', focus })
      .then((r) => r.ok)
      .catch(() => false),
  closePanel: () => void sendMessage({ type: 'close-panel' }).catch(() => {}),
  focusThread: (id: number) => void sendMessage({ type: 'focus-thread', id }).catch(() => {}),

  async screenshot(id: number): Promise<string | null> {
    try {
      const res = await sendMessage<ScreenshotDataResponse>({ type: 'screenshot-data', id });
      return res.ok ? res.dataUrl : null;
    } catch {
      return null;
    }
  },

  async capture(rect: Rect | null): Promise<ScreenshotUpload | undefined> {
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
  },

  /** Live events from the background. Reconnects when the service worker restarts. */
  subscribe(onEvent: (ev: PortEvent) => void, name = 'brm'): () => void {
    let port: chrome.runtime.Port | null = null;
    let stopped = false;
    const open = () => {
      if (stopped) return;
      try {
        port = chrome.runtime.connect({ name });
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
};
