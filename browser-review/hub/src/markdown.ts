// The Markdown file of a comment: what a developer or an agent reads in .margin/feedback/.
import { formatComment, STATUS_LABELS, type Comment, type ScreenshotMeta } from '@brm/shared';

/** "0012" for comment 12: file names sort in order. */
export function fileId(id: number): string {
  return String(id).padStart(4, '0');
}

export function shotFile(commentId: number, shotId: number): string {
  return `${fileId(commentId)}-${shotId}.png`;
}

function yaml(value: string | number): string {
  return typeof value === 'number' ? String(value) : JSON.stringify(value);
}

function shotLabel(s: ScreenshotMeta): string {
  const what = s.kind === 'page' ? 'Page' : 'Element';
  return `${what}, ${s.source === 'initial' ? 'when the comment was made' : 'captured later'}`;
}

export function renderMarkdown(c: Comment, project: string): string {
  const reviewers = [...new Set(c.messages.filter((m) => m.author === 'user' && m.name).map((m) => m.name!))];
  const front: [string, string | number][] = [
    ['id', c.id],
    ['project', project],
    ['status', c.status],
    ['status_label', STATUS_LABELS[c.status]],
    ['kind', c.kind],
    ['page', c.url],
    ['title', c.title],
    ['reviewers', reviewers.join(', ')],
    ['created', c.createdAt],
    ['updated', c.updatedAt],
  ];
  const out = ['---', ...front.map(([k, v]) => `${k}: ${yaml(v)}`), '---', '', formatComment(c)];
  if (c.screenshots.length) {
    out.push('', '## Images', '');
    for (const s of c.screenshots) out.push(`![${shotLabel(s)}](${shotFile(c.id, s.id)})`, '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}
