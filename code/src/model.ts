// Pure logic over the records read from the vault: conversations, and which project and thread to suggest.
import type { CommentRecord, ReviewRecord } from './vault';

export interface Conversation {
  /** The first comment: it holds the place in the code and `resolved`. */
  root: CommentRecord;
  /** Replies, oldest first. */
  replies: CommentRecord[];
}

export interface Conversations {
  conversations: Conversation[];
  /** Replies whose conversation no longer has its first comment. */
  orphans: CommentRecord[];
}

/** Groups comments into conversations. A reply to a reply belongs to the conversation of the comment it answers. */
export function buildConversations(comments: readonly CommentRecord[]): Conversations {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const rootOf = (comment: CommentRecord): CommentRecord | undefined => {
    const seen = new Set<string>();
    let current: CommentRecord | undefined = comment;
    while (current?.meta.replyTo !== undefined) {
      if (seen.has(current.id)) return undefined; // a loop: no first comment
      seen.add(current.id);
      current = byId.get(current.meta.replyTo);
    }
    return current;
  };

  const conversations = new Map<string, Conversation>();
  const orphans: CommentRecord[] = [];
  const sorted = [...comments].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const c of sorted) if (c.meta.replyTo === undefined) conversations.set(c.id, { root: c, replies: [] });
  for (const c of sorted) {
    if (c.meta.replyTo === undefined) continue;
    const root = rootOf(c);
    const conversation = root && conversations.get(root.id);
    if (conversation) conversation.replies.push(c);
    else orphans.push(c);
  }
  return { conversations: [...conversations.values()], orphans };
}

function latest<T extends { id: string }>(items: readonly T[]): T | undefined {
  return items.reduce<T | undefined>((best, r) => (best === undefined || r.id > best.id ? r : best), undefined);
}

/** The project this repo's latest review is in. */
export function suggestProject(reviews: readonly ReviewRecord[], repo: string): string | undefined {
  return latest(reviews.filter((r) => r.meta.repo === repo))?.project;
}

/**
 * The latest thread in the project that has a review of this repo and branch (of this head commit, for a detached
 * HEAD). That includes submitted reviews, so the next round on a branch lands in the same thread.
 */
export function suggestThread(
  reviews: readonly ReviewRecord[],
  repo: string,
  project: string,
  head: { ref?: string; sha: string },
): string | undefined {
  const same = reviews.filter(
    (r) => r.meta.repo === repo && r.project === project && (head.ref !== undefined ? r.meta.headRef === head.ref : r.meta.head === head.sha),
  );
  return latest(same)?.thread;
}

/** Drafts of these repos, most recently changed first. */
export function resumable(reviews: readonly ReviewRecord[], repos: ReadonlySet<string>): ReviewRecord[] {
  return reviews
    .filter((r) => r.meta.state === 'draft' && repos.has(r.meta.repo))
    .sort((a, b) => (a.meta.updatedAt < b.meta.updatedAt ? 1 : a.meta.updatedAt > b.meta.updatedAt ? -1 : 0));
}
