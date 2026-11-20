import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { STATUSES, STATUS_LABELS, type BridgeCalls, type Comment, type PullSummary, type ScreenshotKind } from '@brm/shared';
import type { BridgeLike } from './bridge.ts';
import { formatComment, formatListLine } from '@brm/shared';

type Content =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: 'image/png' };

interface ToolResult {
  content: Content[];
  isError?: boolean;
  [key: string]: unknown;
}

function text(t: string): ToolResult {
  return { content: [{ type: 'text', text: t }] };
}

/** "data:image/png;base64,AAA" -> image content with "AAA". */
function image(dataUrl: string): Content {
  return { type: 'image', data: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/png' };
}

/** Turns errors (from the extension, or not connected) into readable tool errors instead of protocol errors. */
async function guarded(fn: () => ToolResult | Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: msg }], isError: true };
  }
}

const idSchema = z.number().int().positive().describe('Comment id, the number after # (for example 12).');

const INSTRUCTIONS = `Review comments the user left on their dev app (localhost, a dev domain like *.test, or another site they turned on) with the Margin Browser Review extension.
Each comment is a general page comment or pinned to one element, and is either a plain comment, a request to remove the element, or a request to edit it (text and CSS).
Workflow: list_comments, then for each one get_comment, start_work, fix it in the source code, optionally capture_screenshot to check, then submit_solution with a short note on how you solved it.
You can only set "in progress" and "review ready". The user accepts or reopens in the browser. Use reply to ask the user a question in the thread.
Customer feedback: the developer can add review-hub projects (customers commenting on a staging site) in the extension. list_projects shows them, pull_feedback gets new feedback, and list_comments with project shows one project's feedback. These comments work with the same tools, but your updates on them wait for the developer: they send them to the customer after deploying to staging, in their own words. Write your notes for the developer.`;

export interface McpOptions {
  /** From .margin/project.json in the folder the agent works in: list_comments shows this project's feedback by default. */
  project?: string | null;
}

const UPDATE_EXTENSION = 'This needs a newer Margin extension (1.3 or later) that knows review-hub projects. Update the extension and try again.';

/**
 * A projects or pull call. Extensions from before projects answer undefined, or
 * (newer ones) an error naming the method: both become "update the extension".
 */
async function projectCall<M extends 'projects' | 'pull'>(bridge: BridgeLike, method: M, params: BridgeCalls[M]['params']): Promise<BridgeCalls[M]['result']> {
  let result: BridgeCalls[M]['result'] | undefined;
  try {
    result = await bridge.call(method, params);
  } catch (err) {
    if (err instanceof Error && err.message.includes(`does not know "${method}"`)) throw new Error(UPDATE_EXTENSION);
    throw err;
  }
  if (!Array.isArray(result)) throw new Error(UPDATE_EXTENSION);
  return result;
}

/** On customer feedback the agent's updates wait for the developer to send them. */
function unsent(c: Comment): string {
  return c.outbox?.length
    ? ' The customer does not see this yet: the developer sends it from the sidebar (Send to customer) after deploying to staging.'
    : '';
}

function pullLine(s: PullSummary): string {
  if (s.error) return `${s.project}: pull failed: ${s.error}`;
  const parts = [s.added && `${s.added} new`, s.updated && `${s.updated} updated`, s.removed && `${s.removed} deleted`].filter(Boolean);
  return `${s.project}: ${parts.length ? parts.join(', ') : 'nothing new'}`;
}

export function buildMcpServer(bridge: BridgeLike, version: string, options: McpOptions = {}): McpServer {
  const server = new McpServer({ name: 'browser-review', version }, { instructions: INSTRUCTIONS });
  const defaultProject = options.project ?? null;

  server.registerTool(
    'list_comments',
    {
      description:
        'List review comments. By default only the ones that need work (open and in progress). Returns one line per comment.',
      inputSchema: z.object({
        status: z
          .array(z.enum(STATUSES))
          .optional()
          .describe('Statuses to include. Default ["open", "in_progress"].'),
        origin: z.string().optional().describe('Only this site, for example "http://localhost:5173".'),
        project: z
          .string()
          .optional()
          .describe(
            `Only customer feedback from this review-hub project (see list_projects); pulls it first.${defaultProject ? ` Default "${defaultProject}" (from .margin/project.json); "" for every comment.` : ''}`,
          ),
      }),
    },
    ({ status, origin, project }) =>
      guarded(async () => {
        const statuses = status?.length ? status : (['open', 'in_progress'] as const);
        const name = project === undefined ? defaultProject : project || null;
        let pulled = '';
        if (name) {
          // Fresh feedback first; when the hub is down the summary says so, and the last pulled copies still list.
          const result = await projectCall(bridge, 'pull', { project: name });
          pulled = `${result.map(pullLine).join('\n')}\n\n`;
        }
        const list = await bridge.call('list', { origin, statuses: [...statuses], ...(name ? { project: name } : {}) });
        const labels = statuses.map((s) => STATUS_LABELS[s].toLowerCase()).join(', ');
        const scope = name ? ` from ${name}` : '';
        if (list.length === 0) return text(`${pulled}No comments${scope} with status ${labels}.`);
        return text(
          `${pulled}${list.length} comment(s)${scope} with status ${labels}:\n${list.map(formatListLine).join('\n')}\n\nUse get_comment for the details.`,
        );
      }),
  );

  server.registerTool(
    'list_projects',
    {
      description:
        'List the review-hub projects added in the Margin extension: customer feedback on a staging site. Shows the staging site, when it was last pulled, and errors.',
      inputSchema: z.object({}),
    },
    () =>
      guarded(async () => {
        const list = await projectCall(bridge, 'projects', {});
        if (list.length === 0) {
          return text('No review-hub projects. The developer adds one on the Margin extension\'s help page (Projects), with the hub URL and a developer token.');
        }
        const lines = list.map(
          (p) =>
            `- ${p.name}${p.name === defaultProject ? ' (this repo, from .margin/project.json)' : ''}: staging ${p.origin}, hub ${p.hubUrl}, ${p.lastPull ? `last pulled ${p.lastPull}` : 'not pulled yet'}${p.lastError ? `, last pull failed: ${p.lastError}` : ''}`,
        );
        return text(`${list.length} project(s):\n${lines.join('\n')}\n\nUse list_comments with project to see one project's feedback.`);
      }),
  );

  server.registerTool(
    'pull_feedback',
    {
      description: 'Get new customer feedback from the review hubs now (the extension also pulls every 5 minutes). One project, or all.',
      inputSchema: z.object({
        project: z.string().optional().describe(`Project name. Default: ${defaultProject ? `"${defaultProject}" (from .margin/project.json)` : 'all projects'}.`),
      }),
    },
    ({ project }) =>
      guarded(async () => {
        const name = project ?? defaultProject ?? undefined;
        const result = await projectCall(bridge, 'pull', name ? { project: name } : {});
        if (result.length === 0) return text('No review-hub projects to pull. Add one on the Margin extension\'s help page (Projects).');
        return text(`${result.map(pullLine).join('\n')}\n\nUse list_comments${name ? ` with project "${name}"` : ''} to see them.`);
      }),
  );

  server.registerTool(
    'get_comment',
    {
      description:
        'Get everything about one comment: page, element (selectors, text, HTML, React components, source file), the requested change, the thread and any solution. Attaches the element screenshot (or page screenshot for page comments) unless with_screenshot is false.',
      inputSchema: z.object({
        id: idSchema,
        with_screenshot: z.boolean().optional().describe('Attach the stored screenshot. Default true.'),
      }),
    },
    ({ id, with_screenshot }) =>
      guarded(async () => {
        const c = await bridge.call('get', { id });
        const result = text(formatComment(c));
        if (with_screenshot !== false) {
          const shot = await bridge.call('screenshot', { id, kind: c.target ? 'element' : 'page', which: 'initial' });
          if (shot) result.content.push(image(shot.dataUrl));
        }
        return result;
      }),
  );

  server.registerTool(
    'get_screenshot',
    {
      description:
        'Get a stored screenshot of a comment. "page" is the visible part of the page with the element outlined, "element" is a crop of the element. By default the newest one, which may be a later capture.',
      inputSchema: z.object({
        id: idSchema,
        kind: z.enum(['page', 'element']).optional().describe('Default "page".'),
        which: z
          .enum(['latest', 'initial'])
          .optional()
          .describe('"initial" is the one taken when the comment was made. Default "latest".'),
      }),
    },
    ({ id, kind, which }) =>
      guarded(async () => {
        const k: ScreenshotKind = kind ?? 'page';
        const shot = await bridge.call('screenshot', { id, kind: k, which: which ?? 'latest' });
        if (!shot) return { ...text(`Comment #${id} has no ${k} screenshot.`), isError: true };
        const when = shot.meta.source === 'initial' ? 'taken when the comment was made' : 'captured later';
        return {
          content: [{ type: 'text', text: `${k} screenshot, ${when} (${shot.meta.createdAt}).` }, image(shot.dataUrl)],
        };
      }),
  );

  server.registerTool(
    'capture_screenshot',
    {
      description:
        'Take a fresh screenshot now, to check your fix. The extension switches to an open browser tab on that page, scrolls the element into view and captures it. Needs Brave open with the page loaded. The dev server should have reloaded your change first.',
      inputSchema: z.object({ id: idSchema }),
    },
    ({ id }) =>
      guarded(async () => {
        const result = await bridge.call('capture', { id });
        const content: Content[] = [];
        const note = result.note ? ` ${result.note}` : '';
        content.push({ type: 'text', text: `Fresh page screenshot of ${result.comment.url}.${note}` });
        content.push(image(result.page));
        if (result.element) content.push({ type: 'text', text: 'Crop of the element:' }, image(result.element));
        return { content };
      }),
  );

  server.registerTool(
    'start_work',
    {
      description: 'Mark a comment as in progress. Call this before you start fixing it, so the user sees it.',
      inputSchema: z.object({ id: idSchema }),
    },
    ({ id }) =>
      guarded(async () => {
        const c = await bridge.call('start_work', { id });
        return text(`#${c.id} is now ${STATUS_LABELS[c.status].toLowerCase()}.${unsent(c)}`);
      }),
  );

  server.registerTool(
    'reply',
    {
      description:
        'Write a message in the comment thread, for example a question for the user or an update. Does not change the status.',
      inputSchema: z.object({ id: idSchema, message: z.string().min(1).max(20000) }),
    },
    ({ id, message }) =>
      guarded(async () => {
        const c = await bridge.call('reply', { id, message });
        return text(`Reply added to #${c.id}.${unsent(c)}`);
      }),
  );

  server.registerTool(
    'submit_solution',
    {
      description:
        'Mark a comment as review ready with a short note on how you solved it: what was wrong, what you changed. The user then accepts or reopens it in the browser. For removals and edits the browser preview turns off, so the user sees your real change.',
      inputSchema: z.object({
        id: idSchema,
        note: z.string().min(1).max(5000).describe('Short explanation for the user, a few sentences, plain language.'),
        files: z.array(z.string()).optional().describe('Files you changed, relative to the project root.'),
      }),
    },
    ({ id, note, files }) =>
      guarded(async () => {
        const c = await bridge.call('submit_solution', { id, note, files: files ?? [] });
        return text(`#${c.id} is now review ready.${unsent(c) || ' The user will accept or reopen it.'}`);
      }),
  );

  return server;
}
