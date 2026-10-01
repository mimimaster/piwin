import { describe, expect, it } from 'vitest';

import { resolveShellWriteLock } from './shell-write-policy.js';

/** Golden cases: exclusive = still serialized; optimistic = runs beside others. */
const EXCLUSIVE: Array<[string, string]> = [
  ['git checkout main', 'git-worktree-state'],
  ['git switch -c feature', 'git-worktree-state'],
  ['git -C /repo reset --hard HEAD~1', 'git-worktree-state'],
  ['git -c core.pager=cat stash pop', 'git-worktree-state'],
  ['git --no-pager rebase -i main', 'git-worktree-state'],
  ['git add -A && git stash', 'git-worktree-state'],
  ['cd packages/a && git restore .', 'git-worktree-state'],
  ['git pull --rebase', 'git-worktree-state'],
  ['git clean -fdx', 'git-worktree-state'],
  ["bash -c 'git checkout -- file.ts'", 'git-worktree-state'],
  ['echo $(git stash)', 'git-worktree-state'],
  ['GIT_DIR=.git git merge topic', 'git-worktree-state'],
  ['/usr/bin/git cherry-pick abc123', 'git-worktree-state'],
  ['pnpm install', 'package-install'],
  ['pnpm', 'package-install'],
  ['pnpm i --frozen-lockfile', 'package-install'],
  ['pnpm --filter @piwin/desktop add zod', 'package-install'],
  ['npm ci', 'package-install'],
  ['yarn workspace web add react', 'package-install'],
  ['bun remove lodash', 'package-install'],
  ['sudo npm install -g x', 'package-install'],
  ['npx prettier --write .', 'repo-formatter'],
  ['pnpm exec eslint --fix src', 'repo-formatter'],
  ['prettier -w "src/**/*.ts"', 'repo-formatter'],
  ['biome check --write .', 'repo-formatter'],
];

const OPTIMISTIC: string[] = [
  'pnpm test',
  'pnpm -r typecheck',
  'pnpm --filter @piwin/desktop exec vitest run',
  'pnpm --version',
  'npm run build',
  'npx vitest run src/foo.test.ts',
  'node scripts/check.mjs',
  "python3 - <<'PY'\nprint(1)\nPY",
  "sed -i '' 's/a/b/' file.ts",
  "sed -n '1,40p' file.ts",
  'rg -n "checkout" src',
  'cat package.json | jq .scripts',
  'git status',
  // Index-only; Git's own index.lock serializes these.
  'git add -A && git commit -m "x"',
  'git diff HEAD~1 -- src',
  'git log --oneline -20',
  'git worktree list',
  'git branch -a',
  'ls -la && pwd',
  'prettier --check .',
  'eslint src',
  'echo "git checkout is dangerous"',
];

describe('resolveShellWriteLock', () => {
  it.each(EXCLUSIVE)('takes the exclusive lease for %s', (command, reason) => {
    expect(resolveShellWriteLock(command)).toMatchObject({ mode: 'exclusive', reason });
  });

  it.each(OPTIMISTIC)('runs %s optimistically', (command) => {
    expect(resolveShellWriteLock(command)).toEqual({ mode: 'optimistic' });
  });

  it('names the matching segment for diagnostics', () => {
    expect(resolveShellWriteLock('pnpm test && git stash')).toEqual({
      mode: 'exclusive',
      reason: 'git-worktree-state',
      command: 'git stash',
    });
  });
});
