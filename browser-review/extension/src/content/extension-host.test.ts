import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TabRequest } from '../messages.ts';
import { createExtensionHost } from './extension-host.ts';

type MessageListener = (req: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean;
type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

/** The parts of `chrome` the host uses, as a global. Returns the registered listeners. */
function fakeChrome(sendMessage: (req: unknown) => Promise<unknown> = async () => ({ ok: true, data: [] })) {
  const messages = new Set<MessageListener>();
  const storage = new Set<StorageListener>();
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        id: 'brm-test',
        sendMessage,
        onMessage: { addListener: (l: MessageListener) => messages.add(l), removeListener: (l: MessageListener) => messages.delete(l) },
      },
      storage: {
        onChanged: { addListener: (l: StorageListener) => storage.add(l), removeListener: (l: StorageListener) => storage.delete(l) },
      },
    },
  });
  return { messages, storage };
}

/** Delivers a runtime message like Chrome: returns the listener's result and what it answered. */
function deliver(messages: Set<MessageListener>, req: TabRequest) {
  const answers: unknown[] = [];
  const [listener] = messages;
  assert.ok(listener, 'no onMessage listener');
  const returned = listener(req, {}, (r) => answers.push(r));
  return { returned, answers };
}

const hover: TabRequest = { type: 'hover', id: 3 };

test('onRequest: a promise is answered later, and the listener returns true to keep the channel open', async () => {
  const { messages } = fakeChrome();
  const { promise: answer, resolve } = Promise.withResolvers<{ note: string }>();
  const stop = createExtensionHost().onRequest(() => answer);
  const { returned, answers } = deliver(messages, hover);
  assert.equal(returned, true);
  assert.deepEqual(answers, []);
  resolve({ note: 'done' });
  await answer; // the host's then() was attached first, so it has run
  assert.deepEqual(answers, [{ note: 'done' }]);
  stop();
  assert.equal(messages.size, 0);
});

test('onRequest: a plain value is answered at once and the listener returns false; undefined answers nothing', () => {
  const { messages } = fakeChrome();
  const host = createExtensionHost();
  const stopPlain = host.onRequest(() => ({ note: null }));
  assert.deepEqual(deliver(messages, hover), { returned: false, answers: [{ note: null }] });
  stopPlain();
  host.onRequest(() => undefined);
  assert.deepEqual(deliver(messages, hover), { returned: false, answers: [] });
});

test('settings.watch: fires only for the local area and its own key, until unwatched', () => {
  const { storage } = fakeChrome();
  const seen: unknown[] = [];
  const unwatch = createExtensionHost().settings.watch('sendKey', (v) => seen.push(v));
  const fire = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    for (const l of storage) l(changes, area);
  };
  fire({ sendKey: { newValue: 'enter' } }, 'session');
  fire({ sendKey: { newValue: 'enter' } }, 'sync');
  fire({ holdToPick: { newValue: 'off' } }, 'local');
  assert.deepEqual(seen, []);
  fire({ sendKey: { newValue: 'ctrl-enter' } }, 'local');
  fire({ sendKey: {} }, 'local'); // removed
  assert.deepEqual(seen, ['ctrl-enter', undefined]);
  unwatch();
  assert.equal(storage.size, 0);
});

test('comments: after "Extension context invalidated" a call rejects with the reload message', async () => {
  const reloaded = { message: 'The extension was reloaded. Reload this page.' };
  fakeChrome(() => {
    throw new Error('Extension context invalidated.');
  });
  const host = createExtensionHost();
  await assert.rejects(host.comments.list('http://localhost:5173'), reloaded);
  await assert.rejects(host.comments.reply(1, 'hi'), reloaded);

  // The same when the browser rejects instead of throwing.
  fakeChrome(() => Promise.reject(new Error('Extension context invalidated.')));
  await assert.rejects(createExtensionHost().comments.accept(1), reloaded);
});

test('comments: a store error from the background reaches the caller as is', async () => {
  fakeChrome(async () => ({ ok: false, error: 'Comment #9 does not exist.' }));
  await assert.rejects(createExtensionHost().comments.remove(9), { message: 'Comment #9 does not exist.' });
});
