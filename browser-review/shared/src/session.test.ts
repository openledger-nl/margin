import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activeSession, leaveSession, touchSession, SESSION_GAP_MS } from './session.ts';

describe('browse session', () => {
  it('collects the pages opened, once each', () => {
    const t = Date.parse('2026-11-20T10:00:00Z');
    let s = touchSession(null, '/', t);
    s = touchSession(s, '/pricing', t + 60_000);
    s = touchSession(s, '/', t + 120_000);
    assert.deepEqual(s.paths, ['/', '/pricing']);
    assert.equal(s.start, '2026-11-20T10:00:00.000Z');
    assert.equal(s.last, '2026-11-20T10:02:00.000Z');
  });

  it('starts over after a long break', () => {
    const t = Date.parse('2026-11-20T10:00:00Z');
    const s = touchSession(null, '/', t);
    assert.equal(activeSession(s, t + SESSION_GAP_MS + 1), null);
    assert.deepEqual(touchSession(s, '/blog', t + SESSION_GAP_MS + 1).paths, ['/blog']);
  });

  it('knows the page open now, and none after leaving', () => {
    const t = Date.parse('2026-11-20T10:00:00Z');
    const s = touchSession(touchSession(touchSession(null, '/', t), '/pricing', t + 1000), '/', t + 2000);
    assert.equal(s.current, '/', 'back on / within a minute: still right');
    assert.equal(leaveSession(s, t + 3000)?.current, null);
    assert.deepEqual(leaveSession(s, t + 3000)?.paths, ['/', '/pricing']);
  });

  it('ignores broken values', () => {
    assert.equal(activeSession('nope'), null);
    assert.equal(activeSession({ start: 1, last: 'x', paths: [] }), null);
  });
});
