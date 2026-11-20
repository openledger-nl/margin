import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Comment } from './index.ts';
import { formatComment } from './format.ts';

const comment: Comment = {
  id: 3,
  kind: 'comment',
  status: 'open',
  origin: 'https://staging.example.com',
  path: '/',
  url: 'https://staging.example.com/',
  title: 'Home',
  viewport: { width: 1440, height: 900, dpr: 1 },
  target: null,
  change: null,
  messages: [
    { id: 1, author: 'user', body: 'Logo too small', createdAt: '2026-11-20T10:00:00.000Z', name: 'Anna (client)' },
    { id: 2, author: 'claude', body: 'Which size?', createdAt: '2026-11-20T10:05:00.000Z' },
  ],
  solution: null,
  screenshots: [],
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:05:00.000Z',
};

describe('formatComment', () => {
  it('shows who wrote a message when its name is known', () => {
    const text = formatComment(comment);
    assert.match(text, /- User \(Anna \(client\)\) \(2026-11-20T10:00:00.000Z\): Logo too small/);
    assert.match(text, /- Agent \(2026-11-20T10:05:00.000Z\): Which size\?/);
  });
});
