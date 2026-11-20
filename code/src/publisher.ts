// The seam for posting a submitted review elsewhere (GitHub, GitLab…). None exist yet: margin-code keeps reviews
// in the Ledger vault, and posting them is a later, optional step that plugs in here.
import type { CommentRecord, ReviewRecord } from './vault';

export interface SubmittedReview {
  review: ReviewRecord;
  /** Every comment and reply of the review, oldest first. */
  comments: readonly CommentRecord[];
  /** The repository's root folder on this machine. */
  repoRoot: string;
}

export interface Publisher {
  readonly id: string;
  /** For a button: "Post to GitHub". */
  readonly label: string;
  /** Whether this review can go there (its repo is on that forge, there is a pull request for its branch…). */
  canPublish(review: SubmittedReview): Promise<boolean>;
  publish(review: SubmittedReview): Promise<void>;
}

const publishers: Publisher[] = [];

export function registerPublisher(publisher: Publisher): void {
  publishers.push(publisher);
}

export async function publishersFor(review: SubmittedReview): Promise<Publisher[]> {
  const usable: Publisher[] = [];
  for (const p of publishers) if (await p.canPublish(review).catch(() => false)) usable.push(p);
  return usable;
}
