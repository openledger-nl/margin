// Ledger's ids and timestamps (see src-tauri/src/ids.rs in Ledger): "<epoch-millis>-<8 chars of [0-9a-z]>",
// which sort chronologically as strings, and ISO-8601 UTC with milliseconds.
import { randomBytes } from 'node:crypto';

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

export const ID_PATTERN = /^\d+-[0-9a-z]+$/;

export function formatMillis(millis: number): string {
  return new Date(millis).toISOString();
}

function randomString(length: number): string {
  let out = '';
  for (const byte of randomBytes(length)) out += BASE36[byte % 36];
  return out;
}

export interface Stamp {
  id: string;
  at: string;
}

/** Where ids and timestamps come from. The vault takes one, so a test can make every file come out the same. */
export interface Ids {
  /** An id together with the moment it stands for. */
  stamp(): Stamp;
  /** The current moment as a timestamp. */
  now(): string;
}

/**
 * Ids from a clock (epoch millis) and a source of random [0-9a-z] text. The clock is nudged forward when two
 * calls land in the same millisecond, so ids made in a row keep their order.
 */
export function createIds(clock: () => number = Date.now, random: (length: number) => string = randomString): Ids {
  let last = 0;
  const next = () => (last = Math.max(clock(), last + 1));
  return {
    stamp() {
      const millis = next();
      return { id: `${millis}-${random(8)}`, at: formatMillis(millis) };
    },
    now: () => formatMillis(next()),
  };
}

/** The wall clock and real randomness: what every vault uses unless told otherwise. */
export const systemIds: Ids = createIds();

/**
 * A repeatable source for fixtures: the clock starts at `start` and moves `step` ms per call, and the random
 * part comes from a fixed seed.
 */
export function fixedIds(start: number, step: number, seed = 1): Ids {
  let t = start - step;
  let state = seed >>> 0;
  const random = (length: number) => {
    let out = '';
    for (let i = 0; i < length; i++) {
      // xorshift32
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      out += BASE36[state % 36];
    }
    return out;
  };
  return createIds(() => (t += step), random);
}
