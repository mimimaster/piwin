import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionRule } from '@piwin/contracts';
import { createBundledRuleSet } from './permission-defaults.js';
import { loadMergedPermissionRules } from './permission-rule-loader.js';

/**
 * Helper: write a permissions.json-shaped file at `filePath`.
 */
async function writeRulesFile(filePath: string, contents: unknown): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(contents, null, 2)}\n`, 'utf8');
}

function bashRule(
  pattern: string,
  decision: PermissionRule['decision'],
  reason: string,
): PermissionRule {
  return { target: { kind: 'bash', pattern }, decision, reason };
}

function fileWriteRule(
  pathGlob: string,
  decision: PermissionRule['decision'],
  reason: string,
): PermissionRule {
  return { target: { kind: 'file-write', pathGlob }, decision, reason };
}

describe('loadMergedPermissionRules', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns bundled-only set when no files exist', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-loader-empty-'));
    const projectPath = await mkdtemp(join(tmpdir(), 'piwin-loader-empty-proj-'));
    const merged = await loadMergedPermissionRules({ piwinRoot, projectPath });
    const bundled = createBundledRuleSet();
    expect(merged.deny).toEqual(bundled.deny);
    expect(merged.ask).toEqual(bundled.ask);
    expect(merged.allow).toEqual(bundled.allow);
    // No warnings when files simply do not exist.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('parses a valid version:1 user-global file', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-loader-user-'));
    await writeRulesFile(join(piwinRoot, 'permissions.json'), {
      version: 1,
      deny: [bashRule('rm -rf /nope', 'deny', 'user-deny')],
      ask: [bashRule('*sudo*', 'ask', 'user-ask')],
      allow: [bashRule('npm run *', 'allow', 'user-allow')],
    });
    const merged = await loadMergedPermissionRules({ piwinRoot });
    expect(merged.deny.some((r) => r.reason === 'user-deny')).toBe(true);
    expect(merged.ask.some((r) => r.reason === 'user-ask')).toBe(true);
    expect(merged.allow.some((r) => r.reason === 'user-allow')).toBe(true);
  });

  it('skips invalid JSON with a warning', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-loader-badjson-'));
    const filePath = join(piwinRoot, 'permissions.json');
    await mkdir(piwinRoot, { recursive: true });
    await writeFile(filePath, '{ not valid json ,,, }', 'utf8');
    const merged = await loadMergedPermissionRules({ piwinRoot });
    // Bundled only — no user contribution.
    expect(merged.deny).toEqual(createBundledRuleSet().deny);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('skips unknown version with a warning and empty contribution', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-loader-ver-'));
    await writeRulesFile(join(piwinRoot, 'permissions.json'), {
      version: 99,
      deny: [bashRule('rm -rf /nope', 'deny', 'should-be-skipped')],
    });
    const merged = await loadMergedPermissionRules({ piwinRoot });
    expect(merged.deny.some((r) => r.reason === 'should-be-skipped')).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('drops invalid rules (missing target.kind) with a warning', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-loader-badrule-'));
    await writeRulesFile(join(piwinRoot, 'permissions.json'), {
      version: 1,
      deny: [
        { target: { pattern: 'rm -rf /nope' }, decision: 'deny', reason: 'bad-no-kind' },
        bashRule('rm -rf /ok', 'deny', 'good-deny'),
      ],
    });
    const merged = await loadMergedPermissionRules({ piwinRoot });
    expect(merged.deny.some((r) => r.reason === 'good-deny')).toBe(true);
    expect(merged.deny.some((r) => r.reason === 'bad-no-kind')).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('drops rules whose decision does not match their bucket', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-loader-mismatch-'));
    await writeRulesFile(join(piwinRoot, 'permissions.json'), {
      version: 1,
      deny: [
        // decision 'allow' inside deny bucket — must be dropped.
        bashRule('npm run *', 'allow', 'misplaced-allow'),
        bashRule('rm -rf /ok', 'deny', 'good-deny'),
      ],
    });
    const merged = await loadMergedPermissionRules({ piwinRoot });
    expect(merged.deny.some((r) => r.reason === 'good-deny')).toBe(true);
    expect(merged.deny.some((r) => r.reason === 'misplaced-allow')).toBe(false);
    expect(merged.allow.some((r) => r.reason === 'misplaced-allow')).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('merges in order: bundled, user, project shared, project local', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-loader-order-user-'));
    const projectPath = await mkdtemp(join(tmpdir(), 'piwin-loader-order-proj-'));
    await writeRulesFile(join(piwinRoot, 'permissions.json'), {
      version: 1,
      deny: [bashRule('user-deny-pattern', 'deny', 'user-deny')],
    });
    await writeRulesFile(join(projectPath, '.piwin', 'permissions.json'), {
      version: 1,
      deny: [bashRule('shared-deny-pattern', 'deny', 'shared-deny')],
    });
    await writeRulesFile(join(projectPath, '.piwin', 'permissions.local.json'), {
      version: 1,
      deny: [bashRule('local-deny-pattern', 'deny', 'local-deny')],
    });
    const merged = await loadMergedPermissionRules({
      piwinRoot,
      projectPath,
      projectTrusted: true,
    });
    const denyReasons = merged.deny.map((r) => r.reason);
    const bundledReasons = createBundledRuleSet().deny.map((r) => r.reason);
    const bundledEnd = bundledReasons.length;
    // Bundled first.
    expect(denyReasons.slice(0, bundledEnd)).toEqual(bundledReasons);
    // Then user, shared, local.
    expect(denyReasons.slice(bundledEnd)).toEqual(['user-deny', 'shared-deny', 'local-deny']);
  });

  it('untrusted project: strips allow from project shared/local, keeps deny/ask', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-loader-untrusted-user-'));
    const projectPath = await mkdtemp(join(tmpdir(), 'piwin-loader-untrusted-proj-'));
    await writeRulesFile(join(projectPath, '.piwin', 'permissions.json'), {
      version: 1,
      deny: [bashRule('shared-deny', 'deny', 'shared-deny')],
      ask: [bashRule('shared-ask', 'ask', 'shared-ask')],
      allow: [bashRule('shared-allow', 'allow', 'shared-allow')],
    });
    await writeRulesFile(join(projectPath, '.piwin', 'permissions.local.json'), {
      version: 1,
      deny: [bashRule('local-deny', 'deny', 'local-deny')],
      allow: [bashRule('local-allow', 'allow', 'local-allow')],
    });
    const merged = await loadMergedPermissionRules({
      piwinRoot,
      projectPath,
      projectTrusted: false,
    });
    expect(merged.deny.some((r) => r.reason === 'shared-deny')).toBe(true);
    expect(merged.deny.some((r) => r.reason === 'local-deny')).toBe(true);
    expect(merged.ask.some((r) => r.reason === 'shared-ask')).toBe(true);
    expect(merged.allow.some((r) => r.reason === 'shared-allow')).toBe(false);
    expect(merged.allow.some((r) => r.reason === 'local-allow')).toBe(false);
  });

  it('trusted project: includes project allow arrays', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-loader-trusted-user-'));
    const projectPath = await mkdtemp(join(tmpdir(), 'piwin-loader-trusted-proj-'));
    await writeRulesFile(join(projectPath, '.piwin', 'permissions.json'), {
      version: 1,
      allow: [bashRule('shared-allow', 'allow', 'shared-allow')],
    });
    await writeRulesFile(join(projectPath, '.piwin', 'permissions.local.json'), {
      version: 1,
      allow: [bashRule('local-allow', 'allow', 'local-allow')],
    });
    const merged = await loadMergedPermissionRules({
      piwinRoot,
      projectPath,
      projectTrusted: true,
    });
    expect(merged.allow.some((r) => r.reason === 'shared-allow')).toBe(true);
    expect(merged.allow.some((r) => r.reason === 'local-allow')).toBe(true);
  });

  it('defaults projectTrusted to false when projectPath set but trust unknown', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-loader-default-trust-'));
    const projectPath = await mkdtemp(join(tmpdir(), 'piwin-loader-default-trust-proj-'));
    await writeRulesFile(join(projectPath, '.piwin', 'permissions.json'), {
      version: 1,
      allow: [bashRule('shared-allow', 'allow', 'shared-allow')],
    });
    const merged = await loadMergedPermissionRules({ piwinRoot, projectPath });
    expect(merged.allow.some((r) => r.reason === 'shared-allow')).toBe(false);
  });

  it('expands ~ in path globs when materializing rules', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-loader-tilde-'));
    await writeRulesFile(join(piwinRoot, 'permissions.json'), {
      version: 1,
      ask: [fileWriteRule('~/.secret-dir/**', 'ask', 'user-secret-ask')],
    });
    const merged = await loadMergedPermissionRules({ piwinRoot });
    const rule = merged.ask.find((r) => r.reason === 'user-secret-ask');
    expect(rule).toBeDefined();
    expect(rule!.target.kind).toBe('file-write');
    if (rule!.target.kind === 'file-write') {
      // ~ should be expanded to the real home directory, not left literal.
      expect(rule!.target.pathGlob.startsWith('~/')).toBe(false);
      expect(rule!.target.pathGlob.includes('.secret-dir/**')).toBe(true);
    }
  });
});
