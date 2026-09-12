import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HostRuntime } from '../host-runtime.js';

describe('skills/uninstall', () => {
  it('refuses to uninstall a bundled skill', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-skill-uninstall-bundled-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const listed = await runtime.handleCommand({ type: 'skills/list' });
    expect(listed.success).toBe(true);
    const skills = listed.success
      ? (listed.data as { skills: Array<{ id: string; source: string }> }).skills
      : [];
    const bundled = skills.find((skill) => skill.source === 'bundled');
    expect(bundled).toBeTruthy();
    const removed = await runtime.handleCommand({
      type: 'skills/uninstall',
      skillId: bundled!.id,
    });
    expect(removed.success).toBe(false);
    if (!removed.success) {
      expect(removed.error).toContain('cannot be uninstalled');
    }
    await runtime.dispose();
  });

  it('refuses to disable a bundled skill', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-skill-toggle-bundled-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const listed = await runtime.handleCommand({ type: 'skills/list' });
    expect(listed.success).toBe(true);
    const skills = listed.success
      ? (listed.data as { skills: Array<{ id: string; source: string }> }).skills
      : [];
    const bundled = skills.find((skill) => skill.source === 'bundled');
    expect(bundled).toBeTruthy();
    const toggled = await runtime.handleCommand({
      type: 'skills/set_enabled',
      skillId: bundled!.id,
      enabled: false,
    });
    expect(toggled.success).toBe(false);
    if (!toggled.success) {
      expect(toggled.error).toContain('cannot be disabled');
    }
    await runtime.dispose();
  });

  it('uninstalls a user-installed skill', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-skill-uninstall-user-'));
    const skillDir = join(rootDir, 'skills', 'my-notes');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: my-notes\ndescription: Personal\n---\n# Notes\n',
      'utf8',
    );
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const removed = await runtime.handleCommand({
      type: 'skills/uninstall',
      skillId: 'my-notes',
    });
    expect(removed.success).toBe(true);
    const listed = await runtime.handleCommand({ type: 'skills/list' });
    expect(listed.success).toBe(true);
    if (listed.success) {
      const skills = (listed.data as { skills: Array<{ id: string }> }).skills;
      expect(skills.some((skill) => skill.id === 'my-notes')).toBe(false);
    }
    await runtime.dispose();
  });
});
