// Ledger's ids and timestamps (see src-tauri/src/ids.rs in Ledger): "<epoch-millis>-<8 chars of [0-9a-z]>",
// which sort chronologically as strings, and ISO-8601 UTC with milliseconds.
import { randomBytes } from 'node:crypto';

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

let lastMillis = 0;

/** The wall clock, nudged forward when two calls land in the same millisecond, so ids made in a row keep their order. */
function nextMillis(now = Date.now()): number {
  lastMillis = Math.max(now, lastMillis + 1);
  return lastMillis;
}

function randomString(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += BASE36[byte % 36];
  return out;
}

export function formatMillis(millis: number): string {
  return new Date(millis).toISOString();
}

export interface Stamp {
  id: string;
  at: string;
}

/** An id together with the moment it stands for, from one strictly increasing clock. */
export function newStamp(now?: number): Stamp {
  const millis = nextMillis(now);
  return { id: `${millis}-${randomString(8)}`, at: formatMillis(millis) };
}

export function now(): string {
  return formatMillis(nextMillis());
}

export const ID_PATTERN = /^\d+-[0-9a-z]+$/;
