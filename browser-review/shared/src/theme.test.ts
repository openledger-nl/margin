import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { brandTokens, contrast, normalizeHex, textOn } from './theme.ts';

describe('brand colors', () => {
  it('reads #abc and #aabbcc, and nothing else', () => {
    assert.equal(normalizeHex('#E4572E'), '#e4572e');
    assert.equal(normalizeHex('fa0'), '#ffaa00');
    assert.equal(normalizeHex('red'), null);
    assert.equal(normalizeHex('#12345'), null);
    assert.equal(normalizeHex(42), null);
  });

  it('picks the text color with the most contrast', () => {
    assert.equal(textOn('#1b1f3b'), '#ffffff');
    assert.equal(textOn('#ffd23f'), '#0e1016');
  });

  it('keeps text readable for light and dark brand colors', () => {
    for (const [color, toolbar] of [
      ['#ffd23f', '#ffffff'],
      ['#e4572e', '#1b1f3b'],
      ['#0b3d91', '#0b3d91'],
      ['#f5f5f5', '#f5f5f5'],
    ] as const) {
      const t = brandTokens({ color, toolbar });
      assert.ok(contrast(t['accent-text']!, '#ffffff') >= 3, `${color} as text on white`);
      assert.ok(contrast(t['on-accent']!, color) >= 4.5 || contrast(t['on-accent']!, color) >= contrast(t['on-accent'] === '#ffffff' ? '#0e1016' : '#ffffff', color), `text on ${color}`);
      assert.ok(contrast(t['on-screen']!, toolbar) >= 4.5, `toolbar text on ${toolbar}`);
      assert.ok(contrast(t.prompt!, toolbar) >= 3, `selected tool on ${toolbar}`);
    }
  });

  it('is empty without colors: the Margin look', () => {
    assert.deepEqual(brandTokens({ color: null, toolbar: null }), {});
  });
});
