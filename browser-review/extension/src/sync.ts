// Projects: margin review hubs the developer added, with a developer token.
// Pulling copies the hub's comments into the local store (Comment.project and
// remoteId), so the sidebar and the MCP tools work on them like on any comment.
// The hub stays the owner: status changes go there first (pushToHub).
import type { Comment, OutboxAction, PageVisit, ProjectSummary, PullSummary, SendDecision, Store } from '@brm/shared';
import { HubClient, HubError, normalizeHubUrl } from './hub-client.ts';

/** chrome.storage.local key. Only the background reads it; pages get ProjectSummary, without the token. */
export const PROJECTS_KEY = 'projects';
/** chrome.storage.local key: the developer's own page visits, all sites (PageVisit[]). */
export const VISITS_KEY = 'visits';
/** chrome.storage.local key: a project's visits as pulled from its hub. */
export const projectVisitsKey = (id: string) => `projectVisits:${id}`;

export interface Project extends ProjectSummary {
  token: string;
}

export const DEV_TOKEN_SHAPE = /^mdev_[A-Za-z0-9_-]{20,100}$/;

export function toProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (p): p is Project =>
      typeof p === 'object' && p !== null && typeof p.id === 'string' && typeof p.hubUrl === 'string' && typeof p.token === 'string',
  );
}

export function summary({ token: _t, ...rest }: Project): ProjectSummary {
  return rest;
}

export type ClientFor = (p: Pick<Project, 'hubUrl' | 'token'>) => HubClient;
export const defaultClient: ClientFor = (p) => new HubClient(p.hubUrl, p.token);

/** Checks the hub URL and token with the hub, and returns the new project (not stored yet). */
export async function checkProject(hubUrl: string, token: string, clientFor: ClientFor = defaultClient, id: string = crypto.randomUUID()): Promise<Project> {
  const url = normalizeHubUrl(hubUrl);
  const t = token.trim();
  if (!DEV_TOKEN_SHAPE.test(t)) throw new Error('A developer token starts with mdev_. Create one with: margin token add --developer "Your name".');
  const info = await clientFor({ hubUrl: url, token: t }).project();
  return { id, name: info.name, origin: info.origin, hubUrl: url, you: info.you, lastPull: null, lastError: null, token: t };
}

/** Readable reason for a failed pull or push. */
export function hubErrorMessage(p: Pick<Project, 'name'>, err: unknown): string {
  if (err instanceof HubError && err.status === 401) {
    return `The developer token for ${p.name} no longer works (revoked or expired). Add the project again with a new token on the help page.`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Copies what changed on the hub since the last pull. Returns the counts and the hub's time for the next pull. */
export async function pullProject(
  store: Store,
  p: Project,
  clientFor: ClientFor = defaultClient,
): Promise<{ summary: PullSummary; now: string; origins: Set<string>; visits: PageVisit[] | null }> {
  const client = clientFor(p);
  const changes = await client.changes(p.lastPull);
  let added = 0;
  let updated = 0;
  let removed = 0;
  const origins = new Set<string>();
  for (const remote of changes.comments) {
    const existing = await store.findRemote(p.id, remote.id);
    const shots = new Map<number, string>();
    for (const s of remote.screenshots) {
      if (existing?.screenshots.some((e) => e.remoteId === s.id)) continue;
      shots.set(s.id, await client.screenshot(s.id));
    }
    const result = await store.importRemote(p.id, remote, shots);
    if (result.added) added++;
    else if (result.changed) updated++;
    if (result.changed) origins.add(result.comment.origin);
  }
  for (const remoteId of changes.deleted) {
    const copy = await store.findRemote(p.id, remoteId);
    if (copy && (await store.deleteRemote(p.id, remoteId))) {
      removed++;
      origins.add(copy.origin);
    }
  }
  // Visits for the overview's site map. A hub from before visits has none: not an error.
  let visits: PageVisit[] | null = null;
  try {
    visits = await client.visits();
  } catch {
    visits = null;
  }
  return { summary: { project: p.name, added, updated, removed, error: null }, now: changes.now, origins, visits };
}

export type HubAction = OutboxAction;

/** The decision the sidebar suggests for a comment with unsent updates: fixed with the agent's note, or its question. */
export function suggestDecision(c: Comment): SendDecision {
  const outbox = c.outbox ?? [];
  const solved = outbox.findLast((a) => a.type === 'submit_solution');
  if (solved?.type === 'submit_solution') return { id: c.id, decision: 'fixed', message: solved.note };
  const reply = outbox.findLast((a) => a.type === 'reply');
  return { id: c.id, decision: 'question', message: reply?.type === 'reply' ? reply.message : '' };
}

/**
 * The developer sends one comment to the customer: fixed (review ready, with this
 * note) or more feedback needed (this question, in progress). The agent's queued
 * updates are replaced by what the developer typed; the copy then takes the hub's version.
 */
export async function sendDecision(store: Store, p: Project, c: Comment, d: SendDecision, clientFor: ClientFor = defaultClient): Promise<Comment> {
  if (c.remoteId === undefined) throw new Error(`Comment #${c.id} is not from a review hub.`);
  const message = d.message.trim();
  if (!message) throw new Error(d.decision === 'fixed' ? 'Write what was fixed for the customer.' : 'Write what you want to ask the customer.');
  const client = clientFor(p);
  const seen = c.remote ?? c;
  let remote: Comment;
  try {
    if (seen.status === 'open') remote = await client.startWork(c.remoteId);
    if (d.decision === 'fixed') {
      const solved = (c.outbox ?? []).findLast((a) => a.type === 'submit_solution');
      const files = solved?.type === 'submit_solution' ? solved.files : (c.solution?.files ?? []);
      remote = await client.submitSolution(c.remoteId, message, files);
    } else {
      remote = await client.reply(c.remoteId, message);
    }
  } catch (err) {
    throw new Error(`${hubErrorMessage(p, err)} Not sent.`);
  }
  return (await store.importRemote(p.id, remote, new Map(), { clearOutbox: true })).comment;
}

/**
 * A status change or reply on a hub copy: done on the hub first, then the hub's
 * answer replaces the copy. When the hub can't be reached nothing changes here.
 */
export async function pushToHub(store: Store, p: Project, c: Comment, action: HubAction, clientFor: ClientFor = defaultClient): Promise<Comment> {
  if (c.remoteId === undefined) throw new Error(`Comment #${c.id} is not from a review hub.`);
  const client = clientFor(p);
  let remote: Comment;
  try {
    if (action.type === 'start_work') remote = await client.startWork(c.remoteId);
    else if (action.type === 'reply') remote = await client.reply(c.remoteId, action.message);
    else remote = await client.submitSolution(c.remoteId, action.note, action.files);
  } catch (err) {
    throw new Error(`${hubErrorMessage(p, err)} Nothing was changed.`);
  }
  // New screenshots only come from customers, so the copy's are still complete.
  return (await store.importRemote(p.id, remote)).comment;
}
