import type { Author, Comment, CreateCommentInput, Solution, Status } from './index.ts';

export type ReviewErrorCode = 'not_found' | 'invalid_transition' | 'bad_input';

export class ReviewError extends Error {
  readonly code: ReviewErrorCode;
  constructor(code: ReviewErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ReviewError';
  }
}

export type Action =
  | { type: 'start_work' }
  | { type: 'submit_solution'; note: string; files: string[] }
  | { type: 'message'; author: Author; body: string }
  | { type: 'accept' }
  | { type: 'reopen'; body?: string };

export interface Outcome {
  status: Status;
  solution: Solution | null;
  /** Append in order; the caller supplies message ids and times. */
  messages: { author: Author; body: string }[];
}

/** Pure review transitions. Throws ReviewError without changing the comment. */
export function decide(c: Comment, action: Action, now: string): Outcome {
  const outcome: Outcome = { status: c.status, solution: c.solution, messages: [] };
  switch (action.type) {
    case 'message':
      if (!action.body.trim()) throw new ReviewError('bad_input', 'Message is empty.');
      outcome.messages.push({ author: action.author, body: action.body.trim() });
      break;
    case 'start_work':
      if (c.status === 'in_progress') break;
      if (c.status !== 'open') {
        throw new ReviewError(
          'invalid_transition',
          `Comment #${c.id} is ${c.status}. Only open comments can be started. ` +
            (c.status === 'review_ready' ? 'It is waiting for the user to review.' : 'It is already accepted.'),
        );
      }
      outcome.status = 'in_progress';
      outcome.messages.push({ author: 'system', body: 'The agent started working on this.' });
      break;
    case 'submit_solution':
      if (!action.note.trim()) throw new ReviewError('bad_input', 'The solution note is empty.');
      if (c.status !== 'open' && c.status !== 'in_progress') {
        throw new ReviewError(
          'invalid_transition',
          `Comment #${c.id} is ${c.status}. A solution can only be submitted for open or in progress comments.`,
        );
      }
      outcome.solution = {
        note: action.note.trim(),
        files: action.files.map((f) => f.trim()).filter(Boolean),
        createdAt: now,
      };
      outcome.status = 'review_ready';
      outcome.messages.push({ author: 'system', body: 'The agent marked this review ready.' });
      break;
    case 'accept':
      if (c.status !== 'review_ready') {
        throw new ReviewError('invalid_transition', `Comment #${c.id} is ${c.status}, not review ready.`);
      }
      outcome.status = 'accepted';
      outcome.messages.push({ author: 'system', body: 'Solution accepted.' });
      break;
    case 'reopen':
      if (c.status !== 'review_ready' && c.status !== 'accepted') {
        throw new ReviewError('invalid_transition', `Comment #${c.id} is ${c.status}, it is already open.`);
      }
      if (c.solution) {
        const files = c.solution.files.length ? `\nFiles: ${c.solution.files.join(', ')}` : '';
        outcome.messages.push({ author: 'system', body: `Previous solution (not accepted):\n${c.solution.note}${files}` });
      }
      if (action.body?.trim()) outcome.messages.push({ author: 'user', body: action.body.trim() });
      outcome.solution = null;
      outcome.status = 'open';
      outcome.messages.push({ author: 'system', body: 'Reopened.' });
      break;
  }
  return outcome;
}

/** Creation checks shared by stores; URL policy belongs to the caller. */
export function checkCreate(input: CreateCommentInput): { body: string; page: string | null; element: string | null } {
  if (input.kind === 'comment' && !input.body.trim()) {
    throw new ReviewError('bad_input', 'A comment needs some text.');
  }
  if (input.kind !== 'comment' && input.change?.kind !== input.kind) {
    throw new ReviewError('bad_input', `A ${input.kind} needs a matching change.`);
  }
  if (input.kind !== 'comment' && !input.target) {
    throw new ReviewError('bad_input', `A ${input.kind} needs a target element.`);
  }
  // Check screenshots before writing anything, so bad input leaves no half comment.
  const page = input.screenshots?.page ? checkPngDataUrl(input.screenshots.page) : null;
  const element = input.screenshots?.element ? checkPngDataUrl(input.screenshots.element) : null;
  return { body: input.body.trim() || defaultBody(input), page, element };
}

/** Delete a comment or undo a change, as offered by the sidebar. */
export function canDelete(c: Pick<Comment, 'kind' | 'status'>): boolean {
  return c.kind === 'comment' ? c.status !== 'in_progress' : c.status === 'open' || c.status === 'in_progress';
}

const PNG_DATA_URL = /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]*$/;

/** Checks a "data:image/png;base64,..." string starts like a real PNG. */
export function checkPngDataUrl(dataUrl: string): string {
  if (!PNG_DATA_URL.test(dataUrl)) throw new ReviewError('bad_input', 'Screenshot must be a PNG data URL.');
  return dataUrl;
}

function defaultBody(input: CreateCommentInput): string {
  if (input.kind === 'remove') return 'Remove this element.';
  if (input.kind === 'edit') return 'Apply this edit.';
  return '';
}
