import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTurnOn, isAllowed, isDevUrl, isLocalUrl, matchPatterns, originOf, type SiteSettings } from './sites.ts';

const any = (sites: string[] = []): SiteSettings => ({ access: 'any', sites });
const strict: SiteSettings = { access: 'local', sites: ['https://staging.example.com'] };

test('isLocalUrl: localhost, 127.0.0.1 and [::1], http or https, any port', () => {
  assert.equal(isLocalUrl('http://localhost:5173/cases/1'), true);
  assert.equal(isLocalUrl('https://localhost:5173/'), true);
  assert.equal(isLocalUrl('http://127.0.0.1:3000/'), true);
  assert.equal(isLocalUrl('http://[::1]:8080/'), true);
  assert.equal(isLocalUrl('http://example.com/'), false);
  assert.equal(isLocalUrl('http://localhost.example.com/'), false);
  assert.equal(isLocalUrl('brave://extensions/'), false);
  assert.equal(isLocalUrl('not a url'), false);
});

test('isDevUrl: local addresses and dev domains', () => {
  assert.equal(isDevUrl('https://shop.test/'), true); // Herd, Valet
  assert.equal(isDevUrl('http://app.localhost:3000/'), true);
  assert.equal(isDevUrl('https://my-site.ddev.site/'), true);
  assert.equal(isDevUrl('http://printer.local/'), true);
  assert.equal(isDevUrl('https://example.com/'), false);
  assert.equal(isDevUrl('https://test.example.com/'), false);
  assert.equal(isDevUrl('https://contest/'), false);
  assert.equal(isDevUrl('file:///home/me/index.html'), false);
});

test('isAllowed: dev URLs by themselves, other sites once turned on, strict only local', () => {
  assert.equal(isAllowed('https://shop.test/cart', any()), true);
  assert.equal(isAllowed('https://staging.example.com/', any()), false);
  assert.equal(isAllowed('https://staging.example.com/a', any(['https://staging.example.com'])), true);
  assert.equal(isAllowed('https://staging.example.com:8443/', any(['https://staging.example.com'])), false);
  assert.equal(isAllowed('http://localhost:5173/', strict), true);
  assert.equal(isAllowed('https://shop.test/', strict), false);
  assert.equal(isAllowed('https://staging.example.com/', strict), false);
});

test('canTurnOn: only web pages that are not on yet, and never in strict mode', () => {
  assert.equal(canTurnOn('https://staging.example.com/', any()), true);
  assert.equal(canTurnOn('https://shop.test/', any()), false);
  assert.equal(canTurnOn('chrome://settings/', any()), false);
  assert.equal(canTurnOn('https://staging.example.com/', { access: 'local', sites: [] }), false);
});

test('originOf and matchPatterns', () => {
  assert.equal(originOf('https://staging.example.com:8443/x?y'), 'https://staging.example.com:8443');
  assert.equal(originOf('about:blank'), null);
  assert.deepEqual(matchPatterns({ access: 'local', sites: [] }), ['*://localhost/*', '*://127.0.0.1/*']);
  const patterns = matchPatterns(any(['https://staging.example.com:8443']));
  assert.ok(patterns.includes('*://*.test/*'));
  assert.ok(patterns.includes('https://staging.example.com/*'));
});
