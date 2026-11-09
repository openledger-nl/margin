import { KIND_LABELS, STATUS_LABELS, isPreviewActive, type Comment } from '@brm/shared';

function quote(s: string, max = 80): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return JSON.stringify(flat.length > max ? `${flat.slice(0, max - 1)}…` : flat);
}

/** One line per comment for list_comments. */
export function formatListLine(c: Comment): string {
  const userMsg = c.messages.find((m) => m.author === 'user');
  const where = c.target
    ? `on <${c.target.tag}> ${quote(c.target.text, 40)}${c.target.components.length ? ` in ${c.target.components.at(-1)}` : ''}`
    : 'on the whole page';
  return `#${c.id} [${STATUS_LABELS[c.status]}] ${KIND_LABELS[c.kind]} ${where}, ${c.origin}${c.path}: ${quote(userMsg?.body ?? '', 90)}`;
}

/** Full detail for get_comment, written for an agent that has to fix it in code. */
export function formatComment(c: Comment): string {
  const out: string[] = [];
  out.push(`# Comment #${c.id}: ${KIND_LABELS[c.kind]}, ${STATUS_LABELS[c.status]}`);
  out.push('');
  out.push(`Page: ${c.url}`);
  out.push(`Title: ${c.title || '(none)'}`);
  out.push(`Viewport: ${c.viewport.width}x${c.viewport.height} at ${c.viewport.dpr}x`);
  out.push(`Created: ${c.createdAt}, updated: ${c.updatedAt}`);

  if (c.target) {
    const t = c.target;
    out.push('', '## Element');
    out.push(`Tag: <${t.tag}>`);
    out.push(`Text: ${quote(t.text, 300)}`);
    if (t.components.length) out.push(`React components (outer to inner): ${t.components.join(' > ')}`);
    if (t.source) out.push(`Rendered in: ${t.source} (file is reliable, line number is approximate)`);
    out.push(`Size and position at the time: ${Math.round(t.rect.width)}x${Math.round(t.rect.height)} at (${Math.round(t.rect.x)}, ${Math.round(t.rect.y)})`);
    out.push('Selectors (best first):');
    for (const s of t.selectors) out.push(`- ${s}`);
    out.push('HTML:', '```html', t.html, '```');
  } else {
    out.push('', 'This is a general comment about the whole page, not one element.');
  }

  if (c.change?.kind === 'remove') {
    out.push('', '## Requested change: remove');
    out.push('The user removed this element in the browser. Remove it in the source code.');
  } else if (c.change?.kind === 'edit') {
    out.push('', '## Requested change: edit');
    out.push('The user edited this element in the browser. Make the same change in the source code.');
    if (c.change.texts.length) {
      out.push('Text changes:');
      for (const t of c.change.texts) out.push(`- ${quote(t.before, 200)} becomes ${quote(t.after, 200)}`);
    }
    if (c.change.css.trim()) out.push('CSS the user added to this element:', '```css', c.change.css.trim(), '```');
  }
  if (c.kind !== 'comment') {
    out.push(
      isPreviewActive(c)
        ? 'The change is shown as a preview in the browser until you submit a solution. After that the browser shows the real result from the code.'
        : 'The preview is off: the browser shows the real result from the code.',
    );
  }

  out.push('', '## Thread');
  for (const m of c.messages) {
    const who = m.author === 'user' ? 'User' : m.author === 'claude' ? 'Agent' : 'Status';
    out.push(`- ${who} (${m.createdAt}): ${m.body.replace(/\n/g, '\n  ')}`);
  }

  if (c.solution) {
    out.push('', '## Submitted solution');
    out.push(c.solution.note);
    if (c.solution.files.length) out.push(`Files: ${c.solution.files.join(', ')}`);
  }

  out.push('', '## Screenshots');
  if (c.screenshots.length === 0) out.push('None.');
  for (const s of c.screenshots) {
    out.push(`- ${s.kind} (${s.source === 'initial' ? 'taken when the comment was made' : 'captured later'}, ${s.createdAt})`);
  }

  out.push('', nextStepHint(c));
  return out.join('\n');
}

function nextStepHint(c: Comment): string {
  switch (c.status) {
    case 'open':
      return 'Next: call start_work, fix it in the code, then submit_solution with a short note on how you solved it.';
    case 'in_progress':
      return 'Next: fix it in the code, optionally check with capture_screenshot, then submit_solution.';
    case 'review_ready':
      return 'Waiting for the user to accept or reopen. Nothing to do.';
    case 'accepted':
      return 'Accepted by the user. Nothing to do.';
  }
}
