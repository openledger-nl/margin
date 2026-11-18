import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timeAgo } from './format.ts';
import { DEFAULT_SETTINGS, RECENT_MAX, toSettings } from './settings.ts';
import { TWEAKS, tweakCss } from './tweaks.ts';

test('toSettings fills in defaults and drops wrong values', () => {
  assert.deepEqual(toSettings(undefined), DEFAULT_SETTINGS);
  const s = toSettings({ replaceHome: false, recentCount: 999, repoSort: 'bogus', tweaks: { copilot: false, junk: 'yes' } });
  assert.equal(s.replaceHome, false);
  assert.equal(s.recentCount, RECENT_MAX);
  assert.equal(s.repoSort, DEFAULT_SETTINGS.repoSort);
  assert.deepEqual(s.tweaks, { copilot: false });
});

test('version 2 moves saved settings to "Last pushed by you" once', () => {
  assert.equal(toSettings({ repoSort: 'pushed' }).repoSort, 'mine', 'old saved settings');
  assert.equal(toSettings({ version: 2, repoSort: 'pushed' }).repoSort, 'pushed', 'chosen after the change');
  assert.equal(toSettings({ version: 2, repoSort: 'name' }).repoSort, 'name');
});

test('tweak ids are unique', () => {
  assert.equal(new Set(TWEAKS.map((t) => t.id)).size, TWEAKS.length);
});

test('tweakCss includes defaults and choices', () => {
  const css = tweakCss({});
  assert.match(css, /\.AppHeader-CopilotChat/);
  assert.doesNotMatch(css, /js-yearly-contributions/);
  const changed = tweakCss({ copilot: false, profileGraph: true });
  assert.doesNotMatch(changed, /\.AppHeader-CopilotChat/);
  assert.match(changed, /js-yearly-contributions/);
  assert.equal(tweakCss(Object.fromEntries(TWEAKS.map((t) => [t.id, false]))), '');
});

test('timeAgo', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  assert.equal(timeAgo('2026-11-18T11:59:30Z', now), 'just now');
  assert.equal(timeAgo('2026-11-18T11:15:00Z', now), '45 min ago');
  assert.equal(timeAgo('2026-11-18T09:00:00Z', now), '3 hours ago');
  assert.equal(timeAgo('2026-11-17T09:00:00Z', now), 'yesterday');
  assert.equal(timeAgo('2026-11-08T12:00:00Z', now), '10 days ago');
  assert.equal(timeAgo('2025-03-04T12:00:00Z', now), 'Mar 4, 2025');
  assert.equal(timeAgo('not a date', now), '');
});

