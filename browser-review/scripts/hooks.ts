// Enables the git hooks in .githooks/ (commit message check, version bump).
// Runs as the root "prepare" script on every `pnpm install`. Plain Node, so it
// works the same in cmd.exe, PowerShell and POSIX shells.
//
// Never fails the install: outside a git checkout, or without git, it does nothing.
import { spawnSync } from 'node:child_process';

const git = (...args: string[]) => spawnSync('git', args, { stdio: 'ignore' }).status === 0;

if (git('rev-parse', '--git-dir')) git('config', 'core.hooksPath', '.githooks');
