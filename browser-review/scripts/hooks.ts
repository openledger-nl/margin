// Enables the git hooks in .githooks/ (commit message check).
// Runs as the "prepare" script on every `pnpm install`. Plain Node, so it
// works the same in cmd.exe, PowerShell and POSIX shells.
//
// This package sits in a folder of the Margin repo, and git reads a relative
// core.hooksPath from the top of the repo, so the path includes that folder.
//
// Never fails the install: outside a git checkout, or without git, it does nothing.
import { spawnSync } from 'node:child_process';

const git = (...args: string[]) => spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const prefix = git('rev-parse', '--show-prefix');
if (prefix.status === 0) git('config', 'core.hooksPath', `${prefix.stdout.trim()}.githooks`);
