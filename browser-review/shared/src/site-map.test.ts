import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Comment, PageVisit } from './index.ts';
import { buildSiteMap, formatSiteMap, mergeVisit } from './site-map.ts';

const O = 'https://staging.acme.com';

function comment(id: number, path: string, status: Comment['status'] = 'open', name = 'Anna'): Comment {
  return {
    id, kind: 'comment', status, origin: O, path, url: `${O}${path}`, title: `Page ${path}`,
    viewport: { width: 1, height: 1, dpr: 1 }, target: null, change: null,
    messages: [{ id: 1, author: 'user', body: `Feedback on ${path}`, createdAt: '2026-11-20T10:00:00.000Z', name }],
    solution: null, screenshots: [], createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z',
  };
}

const visit = (path: string, by: string, at = '2026-11-20T11:00:00.000Z'): PageVisit => ({ origin: O, path, title: `T ${path}`, by, firstAt: at, lastAt: at, count: 1 });

describe('buildSiteMap', () => {
  it('makes a tree of visited and commented pages, with their parents', () => {
    const root = buildSiteMap(
      [comment(1, '/'), comment(2, '/blog/launch', 'review_ready'), comment(3, '/blog/launch')],
      [visit('/', 'Anna'), visit('/features', 'Bob'), visit('/blog/launch', 'Bob', '2026-11-20T12:00:00.000Z'), visit('/blog/launch', 'Anna')],
    );
    assert.deepEqual(root.children.map((c) => c.path), ['/blog', '/features']);
    const blog = root.children[0]!;
    assert.equal(blog.visited, false, 'a parent nobody opened');
    const launch = blog.children[0]!;
    assert.deepEqual(launch.counts, { open: 1, in_progress: 0, review_ready: 1, accepted: 0 });
    assert.deepEqual(launch.visitors.map((v) => v.by), ['Bob', 'Anna']);
    assert.equal(root.total, 3);
    assert.equal(root.children[1]!.comments.length, 0, 'visited without feedback');
  });

  it('writes Markdown with pages, visitors and comment files', () => {
    const md = formatSiteMap(buildSiteMap([comment(2, '/pricing', 'in_progress')], [visit('/pricing', 'Anna'), visit('/about', 'Bob')]), { project: 'acme', origin: O });
    assert.match(md, /- `\/pricing` "T \/pricing", visited by Anna, 1 in progress/);
    assert.match(md, /#2 \[In progress\] Anna: Feedback on \/pricing \(feedback\/0002.md\)/);
    assert.match(md, /- `\/about` "T \/about", visited by Bob, no feedback/);
  });
});

describe('mergeVisit', () => {
  it('counts one view per minute per person and page', () => {
    let list = mergeVisit([], { origin: O, path: '/', title: 'Home', by: 'Anna', at: '2026-11-20T10:00:00.000Z' });
    list = mergeVisit(list, { origin: O, path: '/', title: 'Home', by: 'Anna', at: '2026-11-20T10:00:30.000Z' });
    list = mergeVisit(list, { origin: O, path: '/', title: 'Home!', by: 'Anna', at: '2026-11-20T10:02:00.000Z' });
    list = mergeVisit(list, { origin: O, path: '/', title: 'Home', by: 'Bob', at: '2026-11-20T10:03:00.000Z' });
    assert.equal(list.length, 2);
    assert.deepEqual([list[0]!.count, list[0]!.title, list[0]!.lastAt], [2, 'Home!', '2026-11-20T10:02:00.000Z']);
  });

  it('shows focus pages, also before anyone opened them', () => {
    const tree = buildSiteMap([], [], [{ path: '/checkout/pay', note: 'Try a wrong card' }]);
    const pay = tree.children[0]!.children[0]!;
    assert.equal(pay.path, '/checkout/pay');
    assert.equal(pay.focus, 'Try a wrong card');
    assert.equal(pay.visited, false);
    assert.match(formatSiteMap(tree, { project: 'p', origin: 'o' }), /`\/checkout\/pay` focus page \("Try a wrong card"\), not visited/);
  });
});
