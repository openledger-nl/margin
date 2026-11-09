import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Rect, TargetInfo } from '@brm/shared';
import { parseHTML } from 'linkedom';
import { findTarget, HOST_TAG, textOf } from './targets.ts';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
afterEach(() => {
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});

function page(html: string): void {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document, writable: true });
}

function element(id: string, rect: Rect = target.rect): HTMLElement {
  const el = document.getElementById(id);
  assert.ok(el);
  // LinkeDOM has no layout engine; give candidates explicit viewport rectangles.
  el.getBoundingClientRect = () => ({
    ...rect,
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => rect,
  });
  return el;
}

const target: TargetInfo = {
  selectors: ['body > main > section:nth-of-type(3) > p:nth-of-type(2)'],
  tag: 'p',
  text: 'Pinned text',
  html: '<p>Pinned text</p>',
  rect: { x: 100, y: 200, width: 80, height: 20 },
  components: [],
  source: null,
};

describe('findTarget', () => {
  it('keeps selector order even when a later selector matches the stored text', () => {
    page('<p id="first">Edited text</p><p id="second">Pinned text</p>');
    assert.equal(findTarget({ ...target, selectors: ['#first', '#second'] }), element('first'));
  });

  it('keeps a positional-path hit even when its text has changed', () => {
    page('<main><p id="edited">Edited text</p><p id="old">Pinned text</p></main>');
    assert.equal(findTarget({ ...target, selectors: ['body > main > p:nth-of-type(1)'] }), element('edited'));
  });

  it('still prefers the stored text among several selector matches', () => {
    page('<p>Other text</p><p id="pinned">Pinned text</p>');
    assert.equal(findTarget({ ...target, selectors: ['p'] }), element('pinned'));
  });

  it('recovers by text when a removed sibling breaks the positional path', () => {
    page('<main><section></section><section><p>Other text</p><p id="pinned">Pinned text</p></section></main>');
    assert.equal(findTarget(target), element('pinned'));
  });

  it('chooses the text match whose current rectangle center is closest', () => {
    page('<p id="far">Pinned text</p><p id="near">Pinned text</p><p id="wide">Pinned text</p>');
    element('far', { x: 105, y: 500, width: 80, height: 20 });
    const near = element('near', { x: 110, y: 210, width: 80, height: 20 });
    element('wide', { x: 100, y: 200, width: 800, height: 20 });
    assert.equal(findTarget(target), near);
  });

  it('keeps document order when text matches are equally close', () => {
    page('<p id="first">Pinned text</p><p id="second">Pinned text</p>');
    const first = element('first', { ...target.rect, x: 90 });
    element('second', { ...target.rect, x: 110 });
    assert.equal(findTarget(target), first);
  });

  it('returns null without an exact same-tag text match', () => {
    page('<div>Pinned text</div><p>Pinned text plus more</p><p>pinned text</p>');
    assert.equal(findTarget(target), null);
  });

  it('does not match empty text', () => {
    page('<p></p><p>  \n </p>');
    assert.equal(findTarget({ ...target, text: '' }), null);
  });

  it('ignores overlay-only selector matches and overlay descendants in the fallback', () => {
    page(`<${HOST_TAG}><p id="ours">Pinned text</p></${HOST_TAG}><p id="pinned">Pinned text</p>`);
    element('ours');
    const pinned = element('pinned', { ...target.rect, y: 600 });
    assert.equal(findTarget({ ...target, selectors: ['#ours'] }), pinned);
  });

  it('returns null when only overlay descendants match the text', () => {
    page(`<${HOST_TAG}><p>Pinned text</p></${HOST_TAG}>`);
    assert.equal(findTarget(target), null);
  });

  it('never returns the overlay host itself', () => {
    page(`<${HOST_TAG}>Pinned text</${HOST_TAG}>`);
    assert.equal(findTarget({ ...target, tag: HOST_TAG, selectors: [HOST_TAG] }), null);
  });

  it('continues to the fallback after an invalid stored selector', () => {
    page('<p id="pinned">Pinned text</p>');
    assert.equal(findTarget({ ...target, selectors: ['['] }), element('pinned'));
  });

  it('compares the normalized and shortened textOf value', () => {
    page(`<p id="pinned">  Pinned\n text ${'word '.repeat(80)}</p>`);
    const pinned = element('pinned');
    assert.equal(findTarget({ ...target, text: textOf(pinned) }), pinned);
  });
});
