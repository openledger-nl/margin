// Talks to a margin review hub's developer API (/api/dev/*) with a developer
// token. Only the background worker uses it: the token never reaches a page.
import type { Comment, PageVisit } from '@brm/shared';

export interface HubProject {
  name: string;
  origin: string;
  version: string;
  /** The developer token's name. */
  you: string;
}

export interface HubChanges {
  comments: Comment[];
  /** Hub ids of comments a customer deleted. */
  deleted: number[];
  /** Pass as `since` next time. */
  now: string;
}

/** The hub answered, but no: wrong token, gone, not allowed. */
export class HubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** "staging.acme.com/__margin" -> "https://staging.acme.com/__margin/". Throws on anything else than http(s). */
export function normalizeHubUrl(input: string): string {
  let raw = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  const u = new URL(raw);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('The hub URL starts with https://.');
  u.search = '';
  u.hash = '';
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u.href;
}

export class HubClient {
  readonly #base: URL;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(hubUrl: string, token: string, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.#base = new URL('api/dev/', normalizeHubUrl(hubUrl));
    this.#token = token;
    this.#fetch = fetchImpl;
  }

  async #call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.#fetch(new URL(path, this.#base), {
        method,
        headers: {
          Authorization: `Bearer ${this.#token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw new Error(`Can't reach the review hub at ${this.#base.origin}. Is it running, and is the URL right?`);
    }
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new HubError(res.status, data?.error ?? `The review hub answered ${res.status}.`);
    if (data === null) throw new Error(`That is not a margin review hub: ${this.#base.origin} did not answer with JSON.`);
    return data as T;
  }

  project(): Promise<HubProject> {
    return this.#call('GET', 'project');
  }

  changes(since: string | null): Promise<HubChanges> {
    return this.#call('GET', since ? `comments?since=${encodeURIComponent(since)}` : 'comments');
  }

  /** Every reviewer's page visits (the site map in the overview). */
  async visits(): Promise<PageVisit[]> {
    return (await this.#call<{ visits: PageVisit[] }>('GET', 'visits')).visits;
  }

  async screenshot(id: number): Promise<string> {
    return (await this.#call<{ dataUrl: string }>('GET', `screenshots/${id}`)).dataUrl;
  }

  startWork(id: number): Promise<Comment> {
    return this.#call('POST', `comments/${id}/start_work`, {});
  }

  reply(id: number, message: string): Promise<Comment> {
    return this.#call('POST', `comments/${id}/reply`, { message });
  }

  submitSolution(id: number, note: string, files: string[]): Promise<Comment> {
    return this.#call('POST', `comments/${id}/submit_solution`, { note, files });
  }
}
