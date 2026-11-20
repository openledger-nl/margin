// Margin: Start review, Resume review and Move review to HEAD.
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Git } from '../git';
import { isInside } from '../paths';
import { resumable, suggestProject, suggestThread } from '../model';
import { repoNameOf } from '../repoIdentity';
import { MissingCommitError, ReviewSession } from '../session';
import type { ReviewRecord, ThreadInfo, Vault } from '../vault';
import type { Controller } from './controller';
import { short } from './uris';
import { errorText, pick, requireVault, separator, workspaceRepos } from './workspace';

interface Repo {
  root: string;
  identity: string;
  name: string;
}

async function describeRepos(git: Git, roots: readonly string[]): Promise<Repo[]> {
  const repos = await Promise.all(
    roots.map(async (root) => {
      try {
        const identity = await git.identity(root);
        return { root, identity, name: repoNameOf(identity, path.basename(root)) };
      } catch {
        return undefined; // no commits yet
      }
    }),
  );
  return repos.filter((r): r is Repo => r !== undefined);
}

/** The repository to review: the only one, or the one the user picks (starting on the active editor's). */
async function chooseRepo(repos: readonly Repo[], title: string): Promise<Repo | undefined> {
  if (repos.length <= 1) return repos[0];
  const items = repos.map((r) => ({ label: `$(repo) ${r.name}`, description: r.root, detail: r.identity, repo: r }));
  const editor = vscode.window.activeTextEditor?.document.uri;
  const active = editor?.scheme === 'file' ? items.find((i) => isInside(editor.fsPath, i.repo.root)) : undefined;
  return (await pick(items, { title, placeholder: 'Which repository?', active }))?.repo;
}

/** Opens a review, offering to fetch when this clone lacks its commits. */
async function openSession(vault: Vault, git: Git, file: string, root: string): Promise<ReviewSession | undefined> {
  try {
    return await ReviewSession.open(vault, git, file, root);
  } catch (error) {
    if (!(error instanceof MissingCommitError)) throw error;
    const answer = await vscode.window.showWarningMessage(`${error.message} They may still be on another machine, or need a fetch.`, 'Fetch');
    if (answer !== 'Fetch') return undefined;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Fetching…' }, () => git.fetch(root));
    return ReviewSession.open(vault, git, file, root);
  }
}

async function reveal(): Promise<void> {
  await vscode.commands.executeCommand('margin.review.focus');
}

// ---- Start review ------------------------------------------------------------------------------------------

interface BaseChoice {
  sha: string;
  ref?: string;
}

type BaseItem = vscode.QuickPickItem & { choose?: () => Promise<BaseChoice | undefined> };

async function chooseBase(git: Git, root: string, head: string, headRef: string | undefined): Promise<BaseChoice | undefined> {
  const items: BaseItem[] = [];
  const def = await git.defaultBranch(root);
  const defaultBase = def && (await git.mergeBase(root, 'HEAD', def.ref));
  let active: BaseItem | undefined;
  if (def && defaultBase && defaultBase !== head) {
    active = {
      label: `$(git-merge) Since ${def.name}`,
      description: short(defaultBase),
      detail: `The merge base of HEAD with ${def.ref}: everything this branch adds.`,
      choose: async () => ({ sha: defaultBase, ref: def.name }),
    };
    items.push(active);
  }
  items.push({
    label: '$(edit) Enter a branch, tag or commit…',
    choose: async () => {
      const ref = await vscode.window.showInputBox({
        title: 'Start review: base',
        prompt: 'A branch compares from where HEAD left it (its merge base); a tag or commit compares from exactly there.',
        placeHolder: 'main, v1.2.0, 3f2a9c1…',
        validateInput: async (value) => ((await git.resolveCommit(root, value.trim())) ? undefined : `git doesn't know "${value.trim()}" here.`),
      });
      if (!ref) return undefined;
      const name = ref.trim();
      const sha = (await git.isBranch(root, name)) ? await git.mergeBase(root, 'HEAD', name) : await git.resolveCommit(root, name);
      return sha ? { sha, ref: name } : undefined;
    },
  });

  const branches = (await git.branches(root)).filter((b) => b.name !== headRef && b.sha !== head);
  if (branches.length > 0) {
    items.push(separator('Branches: compare from the merge base'));
    for (const b of branches.slice(0, 50)) {
      items.push({
        label: `$(${b.remote ? 'cloud' : 'git-branch'}) ${b.name}`,
        description: short(b.sha),
        choose: async () => {
          const sha = await git.mergeBase(root, 'HEAD', b.name);
          return sha ? { sha, ref: b.name } : undefined;
        },
      });
    }
  }
  const commits = (await git.recentCommits(root, 16)).filter((c) => c.sha !== head);
  if (commits.length > 0) {
    items.push(separator('Commits on this branch: compare from exactly there'));
    for (const c of commits) items.push({ label: `$(git-commit) ${c.subject}`, description: `${short(c.sha)} · ${c.when}`, choose: async () => ({ sha: c.sha }) });
  }

  for (;;) {
    const picked = await pick(items, { title: 'Start review: base', placeholder: 'Review the changes since…', active });
    if (!picked?.choose) return undefined;
    const choice = await picked.choose();
    if (!choice) continue;
    if (choice.sha === head) {
      void vscode.window.showWarningMessage(`${choice.ref ?? short(choice.sha)} already has everything HEAD has, so there is nothing to review. Pick another base.`);
      continue;
    }
    return choice;
  }
}

export async function startReview(margin: Controller): Promise<void> {
  const git = margin.git();
  const vault = await requireVault();
  if (!vault) return;
  const roots = await workspaceRepos(git);
  if (roots.length === 0) {
    void vscode.window.showErrorMessage('Margin: there is no git repository in this workspace. Open a folder that is one.');
    return;
  }
  const repo = await chooseRepo(await describeRepos(git, roots), 'Start review');
  if (!repo) return;

  const head = await git.head(repo.root);
  if (!head) {
    void vscode.window.showErrorMessage(`Margin: ${repo.name} has no commits yet.`);
    return;
  }
  const headRef = await git.currentBranch(repo.root);
  const reviews = await vault.listReviews();

  // A draft of this branch already exists (maybe from another machine): picking it up is usually what's wanted.
  const drafts = resumable(reviews, new Set([repo.identity])).filter((r) => (headRef ? r.meta.headRef === headRef : r.meta.head === head));
  if (drafts.length > 0 && drafts[0]) {
    const resume = 'Resume Draft';
    const answer = await vscode.window.showInformationMessage(
      `There is already a draft review of ${headRef ?? short(head)}.`,
      { modal: true, detail: 'Resume it, or start another review next to it.' },
      resume,
      'Start New Review',
    );
    if (answer === undefined) return;
    if (answer === resume) {
      await resumeRecord(margin, vault, drafts[0], repo.root);
      return;
    }
  }

  const base = await chooseBase(git, repo.root, head, headRef);
  if (!base) return;

  const projects = await vault.listProjects();
  if (projects.length === 0) {
    void vscode.window.showErrorMessage(`Margin: the Ledger vault at ${vault.root} has no projects yet. Create one in Ledger first.`);
    return;
  }
  const suggested = suggestProject(reviews, repo.identity);
  const projectItems = projects.map((p) => ({
    label: `$(project) ${p.name}`,
    description: p.slug === suggested ? `${p.slug} · last used for ${repo.name}` : p.slug,
    project: p,
  }));
  const project = (
    await pick(projectItems, { title: 'Start review: Ledger project', placeholder: 'Which project is this review for?', active: projectItems.find((i) => i.project.slug === suggested) })
  )?.project;
  if (!project) return;

  const threads = await vault.listThreads(project.slug);
  const suggestedThread = suggestThread(reviews, repo.identity, project.slug, { ref: headRef, sha: head });
  type ThreadItem = vscode.QuickPickItem & { thread?: ThreadInfo; create?: boolean };
  const newItem: ThreadItem = { label: '$(add) New thread', description: `${repo.name}: ${headRef ?? short(head)}`, create: true };
  const threadItems: ThreadItem[] = [newItem];
  if (threads.length > 0) threadItems.push(separator('Threads'));
  for (const t of threads) {
    threadItems.push({
      label: `$(comment-discussion) ${t.title}`,
      description: t.slug === suggestedThread ? 'has reviews of this branch' : t.createdAt.slice(0, 10),
      thread: t,
    });
  }
  const chosen = await pick(threadItems, {
    title: `Start review: thread in ${project.name}`,
    placeholder: 'Where does this review go?',
    active: threadItems.find((i) => i.thread?.slug === suggestedThread) ?? newItem,
  });
  if (!chosen) return;
  let thread = chosen.thread;
  if (chosen.create) {
    const title = await vscode.window.showInputBox({
      title: 'Start review: new thread',
      prompt: `A new thread in ${project.name}`,
      value: `${repo.name}: ${headRef ?? short(head)}`,
      validateInput: (v) => (v.trim() === '' ? 'A thread needs a title.' : undefined),
    });
    if (!title) return;
    thread = await vault.createThread(project.slug, title);
  }
  if (!thread) return;

  const author = (await git.userName(repo.root)) ?? 'unknown';
  const record = await vault.createReview(project.slug, thread.slug, {
    repo: repo.identity,
    repoName: repo.name,
    base: base.sha,
    baseRef: base.ref,
    head,
    headRef,
    author,
  });
  const session = await openSession(vault, git, record.file, repo.root);
  if (!session) return;
  margin.activate(session);
  await reveal();
  void vscode.window.showInformationMessage(
    `Reviewing ${session.files.length} changed ${session.files.length === 1 ? 'file' : 'files'} of ${repo.name}. Comments go to ${vault.relative(record.file).replace(/\.md$/, '/')}.`,
  );
}

// ---- Resume review -----------------------------------------------------------------------------------------

export async function resumeReview(margin: Controller): Promise<void> {
  const git = margin.git();
  const vault = await requireVault();
  if (!vault) return;
  const repos = await describeRepos(git, await workspaceRepos(git));
  const identities = new Set(repos.map((r) => r.identity));
  const drafts = resumable(await vault.listReviews(), identities);
  if (drafts.length === 0) {
    const start = 'Start Review';
    const answer = await vscode.window.showInformationMessage(
      repos.length === 0 ? 'Margin: there is no git repository in this workspace.' : `No draft reviews of ${repos.map((r) => r.name).join(', ')} in the Ledger vault.`,
      ...(repos.length > 0 ? [start] : []),
    );
    if (answer === start) await vscode.commands.executeCommand('margin.startReview');
    return;
  }

  const projectNames = new Map((await vault.listProjects()).map((p) => [p.slug, p.name]));
  const threadTitles = new Map<string, string>();
  for (const project of new Set(drafts.map((d) => d.project))) {
    for (const t of await vault.listThreads(project)) threadTitles.set(`${project}/${t.slug}`, t.title);
  }
  const items = await Promise.all(
    drafts.map(async (d) => {
      const count = await vault.countComments(d.file);
      const where = `${projectNames.get(d.project) ?? d.project} / ${threadTitles.get(`${d.project}/${d.thread}`) ?? d.thread}`;
      return {
        label: `${d.supported ? '$(git-pull-request-draft)' : '$(lock)'} ${d.meta.repoName}: ${d.meta.headRef ?? short(d.meta.head)}`,
        description: `${d.meta.baseRef ?? short(d.meta.base)} → ${short(d.meta.head)}`,
        detail: d.supported
          ? `${where} · ${count} ${count === 1 ? 'comment' : 'comments'} · ${d.meta.author}, ${d.meta.updatedAt.slice(0, 16).replace('T', ' ')}`
          : `${where} · format ${d.meta.format}: needs a newer Margin`,
        record: d,
      };
    }),
  );
  const chosen = (await pick(items, { title: 'Resume review', placeholder: 'Draft reviews of the repositories in this workspace' }))?.record;
  if (!chosen) return;
  if (!chosen.supported) {
    void vscode.window.showWarningMessage(`That review has format ${chosen.meta.format}, newer than this Margin knows, so it is left untouched. Update Margin to resume it.`);
    return;
  }
  const matching = repos.filter((r) => r.identity === chosen.meta.repo);
  const repo = await chooseRepo(matching, 'Resume review');
  if (!repo) return;
  await resumeRecord(margin, vault, chosen, repo.root);
}

async function resumeRecord(margin: Controller, vault: Vault, record: ReviewRecord, root: string): Promise<void> {
  const git = margin.git();
  const session = await openSession(vault, git, record.file, root);
  if (!session) return;
  margin.activate(session);
  await reveal();
  await offerMoveToHead(margin, session, false);
}

// ---- Move review to HEAD -----------------------------------------------------------------------------------

/** When the branch has new commits since the draft's head, offers to review up to HEAD. */
async function offerMoveToHead(margin: Controller, session: ReviewSession, asked: boolean): Promise<void> {
  const git = margin.git();
  const { review } = session;
  const current = await git.head(session.root);
  const branch = await git.currentBranch(session.root);
  if (!current || current === review.head) {
    if (asked) void vscode.window.showInformationMessage(`The review is already at HEAD (${short(review.head)}).`);
    return;
  }
  const ahead = await git.isAncestor(session.root, review.head, current);
  if (!asked && (!ahead || branch !== review.headRef)) return;
  const move = 'Review up to HEAD';
  const answer = await vscode.window.showInformationMessage(
    ahead
      ? `${branch ?? 'HEAD'} has new commits since this review (${short(review.head)} → ${short(current)}). Review up to HEAD in this draft? Comments stay where their code is, or are listed as outdated.`
      : `HEAD (${short(current)}) doesn't follow from this review's ${short(review.head)}. Move the review to HEAD anyway?`,
    move,
    'Keep ' + short(review.head),
  );
  if (answer !== move) return;
  await session.moveHead(current, branch);
}

export async function moveToHead(margin: Controller): Promise<void> {
  const session = margin.session;
  if (!session) {
    void vscode.window.showInformationMessage('There is no active review.');
    return;
  }
  try {
    await offerMoveToHead(margin, session, true);
  } catch (error) {
    void vscode.window.showErrorMessage(`Margin: ${errorText(error)}`);
  }
}
