import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Rect, TargetInfo } from '@brm/shared';
import { parseHTML } from 'linkedom';
import { buildSelectors, findTarget, HOST_TAG, textOf } from './targets.ts';

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

  it('recovers the target when a sibling is inserted before its positional path', () => {
    page('<main><p>Before</p><p>Pinned text</p></main>');
    const pinned = document.querySelector('p:last-child')!;
    const stored = { ...target, selectors: buildSelectors(pinned) };
    const inserted = document.createElement('p');
    inserted.textContent = 'Inserted sibling';
    pinned.before(inserted);
    assert.equal(findTarget(stored), pinned);
  });

  it('keeps a positional-path hit when its text was edited in place', () => {
    page(`<main><p>Before</p><p id="edited">Edited text</p></main>
      <div>Pinned text</div><${HOST_TAG}><p>Pinned text</p></${HOST_TAG}>`);
    const edited = element('edited');
    assert.equal(findTarget({ ...target, selectors: ['body > main > p:nth-of-type(2)'] }), edited);
  });

  it('keeps a direct id selector with changed text authoritative, even when it is last', () => {
    page('<p id="edited">Edited text</p><p>Pinned text</p>');
    assert.equal(findTarget({ ...target, selectors: ['#edited'] }), element('edited'));
  });

  it('keeps an attribute selector with changed text authoritative, even when it is last', () => {
    page('<p id="edited" aria-label="Save">Edited text</p><p>Pinned text</p>');
    assert.equal(findTarget({ ...target, selectors: ['p[aria-label="Save"]'] }), element('edited'));
  });

  it('does not override an earlier positional selector', () => {
    page('<main><p id="edited">Edited text</p><p>Pinned text</p></main>');
    assert.equal(findTarget({
      ...target,
      selectors: ['body > main > p:nth-of-type(1)', 'body > main > p:nth-of-type(2)'],
    }), element('edited'));
  });

  it('recovers a shifted final cssPath rooted at an anchored ancestor', () => {
    page('<main id="container"><p>Inserted sibling</p><p id="pinned">Pinned text</p></main>');
    const pinned = element('pinned');
    assert.equal(findTarget({ ...target, selectors: ['#container > p:nth-of-type(1)'] }), pinned);
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
