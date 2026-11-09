// What the overlay needs from where it runs. Components reach it through
// HostContext; each entry (content script, side panel) creates its own host.
import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useState } from 'preact/hooks';
import type { Comment, CreateCommentInput, Rect, ScreenshotUpload } from '@brm/shared';
import type { PanelState, PortEvent, TabRequest } from '../messages.ts';

/** What the overlay needs from where it runs: today the extension. */
export interface Host {
  readonly comments: CommentApi;
  readonly settings: Settings;
  /** The browser's side panel for threads. Null: threads show in the overlay's own Sidebar. */
  readonly panel: Panel | null;
  /** What the user sees, plus a crop around rect (viewport CSS px). Undefined when it failed: the comment goes without. */
  capture(rect: Rect | null): Promise<ScreenshotUpload | undefined>;
  /** Live status and change events. Returns unsubscribe. */
  subscribe(onEvent: (ev: PortEvent) => void): () => void;
  /**
   * Requests from outside the page: shortcuts, toggle, live capture. A returned
   * promise is the answer, sent when it resolves; a plain value is sent at once;
   * undefined sends nothing. Returns unsubscribe.
   */
  onRequest(handler: (req: TabRequest) => unknown): () => void;
  openHelp(section?: string): void;
  /** False once the host can't be reached anymore (the extension was reloaded). */
  alive(): boolean;
}

/** Rejects with a message to show the user. */
export interface CommentApi {
  list(origin: string): Promise<Comment[]>;
  create(input: CreateCommentInput): Promise<Comment>;
  reply(id: number, body: string): Promise<Comment>;
  accept(id: number): Promise<Comment>;
  reopen(id: number, body?: string): Promise<Comment>;
  remove(id: number): Promise<void>;
  /** An image URL for a stored screenshot (data: or blob:), or null. */
  screenshot(shotId: number): Promise<string | null>;
}

export interface Settings {
  get(key: string): Promise<unknown>;
  /** Fire and forget. */
  set(key: string, value: unknown): void;
  /** Called when something else changes key: the help page, another tab. Returns unsubscribe. */
  watch(key: string, onChange: (value: unknown) => void): () => void;
}

export interface Panel {
  /** Null: the extension was reloaded. */
  state(): Promise<PanelState | null>;
  /** False: the browser refused (no user gesture). */
  open(focus?: number): Promise<boolean>;
  close(): void;
  /** Show this thread in the panel, if it is open. */
  focus(id: number): void;
}

export const HostContext = createContext<Host | null>(null);

export function useHost(): Host {
  const host = useContext(HostContext);
  if (!host) throw new Error('No Host: render inside HostContext.Provider.');
  return host;
}

/**
 * One setting: parse(undefined) until it is read, then the stored value; the
 * setter stores it. live: also follows changes made elsewhere (settings.watch).
 */
export function useSetting<T>(
  key: string,
  parse: (value: unknown) => T,
  opts?: { live?: boolean },
): [T, (value: T) => void] {
  const { settings } = useHost();
  const [value, setValue] = useState<T>(() => parse(undefined));
  const live = opts?.live === true;
  useEffect(() => {
    let current = true;
    settings
      .get(key)
      .then((v) => current && setValue(parse(v)))
      .catch(() => {});
    const unwatch = live ? settings.watch(key, (v) => setValue(parse(v))) : null;
    return () => {
      current = false;
      unwatch?.();
    };
  }, [settings, key, live]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      settings.set(key, v);
    },
    [settings, key],
  );
  return [value, set];
}
