import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalFsPath } from '@piwin/process';
import { createBundledRuleSet } from './permission-defaults.js';
import { evaluateFileWritePermission } from './permission-policy.js';

const piwinRoot = join(homedir(), '.piwin');
const worktreeRoot = join(piwinRoot, 'worktrees', 'repo', 'slot-0');

function evaluate(path: string, writableWorktreeRoot: string | undefined = worktreeRoot) {
  const rules = createBundledRuleSet({
    piwinRoot,
    ...(writableWorktreeRoot ? { writableWorktreeRoot } : {}),
  });
  return evaluateFileWritePermission({ absPath: path, projectRoot: worktreeRoot, mode: 'auto', rules });
}

describe('managed worktree product-root protection', () => {
  it('allows ordinary code in the current lease under the real default product root', () => {
    expect(evaluate(join(worktreeRoot, 'src', 'index.ts'))).toEqual({
      decision: 'allow', reason: 'in-project-allow',
    });
  });

  it('does not grant an exception without a lease or for an invalid storage root', () => {
    const rules = createBundledRuleSet({ piwinRoot });
    expect(evaluateFileWritePermission({
      absPath: join(worktreeRoot, 'src.ts'), projectRoot: worktreeRoot, mode: 'auto', rules,
    })).toEqual({ decision: 'deny', reason: 'piwin-config' });
    expect(evaluate(join(piwinRoot, 'config.json'), piwinRoot).decision).toBe('deny');
    expect(evaluate(join(worktreeRoot, 'src.ts'), join(piwinRoot, 'worktrees')).decision).toBe('deny');
    expect(evaluate(join(worktreeRoot, 'src.ts'), join(piwinRoot, 'worktrees') + '/').decision).toBe('deny');
  });

  it.each(['.env', 'secret.pem', 'credentials.json'])('keeps secret denial for %s inside the lease', (name) => {
    expect(evaluate(join(worktreeRoot, name)).decision).toBe('deny');
  });

  it.each(['config.json', 'permissions.json', 'pi-agent/auth.json', 'sessions/s/transcript.sqlite3', 'worktrees/repo/slot-1/src.ts', 'worktrees/repo/slot-0-evil/src.ts'])(
    'keeps product-root denial for %s', (path) => {
      expect(evaluate(join(piwinRoot, path))).toEqual({ decision: 'deny', reason: 'piwin-config' });
    },
  );

  it('does not suppress a user deny with the same reason or an explicit ask', () => {
    const rules = createBundledRuleSet({ piwinRoot, writableWorktreeRoot: worktreeRoot });
    rules.deny.push({ target: { kind: 'file-write', pathGlob: worktreeRoot + '/**' }, decision: 'deny', reason: 'piwin-config' });
    const input = { absPath: join(worktreeRoot, 'src.ts'), projectRoot: worktreeRoot, mode: 'auto' as const, rules };
    expect(evaluateFileWritePermission(input).decision).toBe('deny');
    rules.deny.pop();
    rules.ask.push({ target: { kind: 'file-write', pathGlob: worktreeRoot + '/**' }, decision: 'ask', reason: 'operator-review' });
    expect(evaluateFileWritePermission(input)).toEqual({ decision: 'ask', reason: 'operator-review' });
  });

  it('protects a custom product root and resolves links even for new files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-managed-policy-'));
    try {
      const lease = join(root, 'worktrees', 'repo', 'slot-0');
      const secretDir = join(root, 'pi-agent');
      await mkdir(lease, { recursive: true });
      await mkdir(secretDir);
      await symlink(secretDir, join(lease, 'link'));
      const rules = createBundledRuleSet({ piwinRoot: canonicalFsPath(root), writableWorktreeRoot: canonicalFsPath(lease) });
      const check = (path: string) => evaluateFileWritePermission({
        absPath: canonicalFsPath(path), projectRoot: canonicalFsPath(lease), mode: 'auto', rules,
      });
      expect(check(join(lease, 'new.ts')).decision).toBe('allow');
      expect(check(join(root, 'config.json'))).toEqual({ decision: 'deny', reason: 'piwin-config' });
      expect(check(join(lease, 'link', 'new.json'))).toEqual({ decision: 'deny', reason: 'piwin-config' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
