// Settings shared by the overlay and the help page, kept in chrome.storage.local.

/** Hold this key to pick an element; release it to stop. Set on the help page. */
export const HOLD_KEY = 'holdToPick';

export const HOLD_KEYS = {
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  off: 'Off',
} as const;

/** A KeyboardEvent.code, or 'off'. */
export type HoldKey = keyof typeof HOLD_KEYS;
export const DEFAULT_HOLD_KEY: HoldKey = 'AltLeft';

export function toHoldKey(value: unknown): HoldKey {
  return typeof value === 'string' && value in HOLD_KEYS ? (value as HoldKey) : DEFAULT_HOLD_KEY;
}

/** Which key sends a comment or reply. Set on the help page. */
export const SEND_KEY = 'sendKey';

export const SEND_KEYS = {
  enter: 'Enter (Shift+Enter for a new line)',
  'ctrl-enter': 'Ctrl+Enter (Enter for a new line)',
} as const;

export type SendKey = keyof typeof SEND_KEYS;
export const DEFAULT_SEND_KEY: SendKey = 'enter';

export function toSendKey(value: unknown): SendKey {
  return typeof value === 'string' && value in SEND_KEYS ? (value as SendKey) : DEFAULT_SEND_KEY;
}

/** Short name for tooltips: "Enter" or "Ctrl+Enter". */
export function sendKeyName(key: SendKey): string {
  return key === 'enter' ? 'Enter' : 'Ctrl+Enter';
}

/** This key press sends. Ctrl+Enter (Cmd+Enter on a Mac) always does. */
export function isSendKey(e: KeyboardEvent, key: SendKey): boolean {
  if (e.key !== 'Enter' || e.isComposing) return false; // isComposing: choosing an IME candidate
  if (e.ctrlKey || e.metaKey) return true;
  return key === 'enter' && !e.shiftKey && !e.altKey;
}
